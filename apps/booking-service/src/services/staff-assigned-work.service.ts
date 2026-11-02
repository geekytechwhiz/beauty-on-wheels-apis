import { ForbiddenError, LambdaRequest, NotFoundError, UnauthorizedError, ValidationError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import {
  STAFF_WORK_VISIT_CAP,
  StaffAssignedWork,
  assignedToCrews,
  eligibleCrews,
  emptyStaffWork,
  pageStaffWork,
  parseStaffWorkQuery,
  staffDates,
} from '../domain/staff-assigned-work';
import { enrichVisitFromPlan } from '../domain/package-visit';
import { BookingError } from '../errors';
import { requestQuery } from '../http/request-query';
import {
  OperationalAccessGateway,
  getOperationalAccessGateway,
} from '../integrations/vendor.client';
import {
  SchedulingCrewGateway,
  getSchedulingCrewGateway,
} from '../integrations/scheduling-crews.client';
import {
  CustomerPlansRepository,
  getCustomerPlansRepository,
} from '../repositories/customer-plans.repository';
import { headerValue } from '../auth/access';
import { parseCompleteVisitBody } from '../schemas/visit-completion.schema';
import { CustomerPlanRecord } from '../types/customer-plan.types';
import { PackageVisitRecord, PackageVisitResponse } from '../types/package-visit.types';
import { PackageVisitsService, getPackageVisitsService } from './package-visits.service';

const baseLogger = createLogger({ service: 'staff-assigned-work', redactPII: true });

export interface StaffVisitActionResult {
  visitId: string;
  status: PackageVisitResponse['status'];
  startedAt?: string;
  completedAt?: string;
  missedAt?: string;
  entitlementConsumed: boolean;
  validationStatus?: PackageVisitResponse['validationStatus'];
  payoutEligible?: boolean;
  idempotent: boolean;
}

function userIdOf(request: LambdaRequest): string | undefined {
  const authUser = request.context.authContext?.userId?.trim();
  if (authUser) return authUser;
  const contextUser = request.context.userContext?.userId?.trim();
  return contextUser || undefined;
}

function clockMissing(visit: PackageVisitRecord): boolean {
  const snapshot = visit.visitWindowSnapshot;
  if (snapshot?.allDay) return false;
  return !snapshot?.startTime || !snapshot?.endTime;
}

/**
 * Staff work is read from the vendor/date visit index and filtered to the
 * caller's active crews. There is no crew-date index.
 *
 * If daily volume outgrows a full vendor/date read, add a GSI with
 * PK `CREW#<crewId>` and SK `DATE#<yyyy-mm-dd>#VISIT#<visitId>`, maintained
 * when crewAssignment is written or cleared. Existing visits would need a
 * backfill from PackageVisit rows. That index is not created for the Kochi MVP.
 */
export class StaffAssignedWorkService {
  private readonly logger = createChildLogger(baseLogger, { service: 'StaffAssignedWorkService' });

  constructor(
    private readonly plans: CustomerPlansRepository = getCustomerPlansRepository(),
    private readonly vendors: OperationalAccessGateway = getOperationalAccessGateway(),
    private readonly crews: SchedulingCrewGateway = getSchedulingCrewGateway(),
    private readonly now: () => Date = () => new Date(),
    private readonly visits?: PackageVisitsService,
  ) {}

  async list(request: LambdaRequest): Promise<StaffAssignedWork> {
    const userId = userIdOf(request);
    if (!userId) throw new UnauthorizedError('Unauthorized');
    const access = await this.vendors.getOperationalAccess(userId);
    if (access.role !== 'staff' || !access.active || !access.vendorId || !access.staffId) {
      throw new ForbiddenError('Not authorized to view assigned work');
    }
    const query = parseStaffWorkQuery(requestQuery(request), this.now());
    const roster = await this.crews.listCrews(access.vendorId);
    const mine = eligibleCrews(roster, access.vendorId, access.staffId);
    if (mine.length === 0) {
      this.logger.info({
        event: 'staff_assigned_work_empty',
        vendorId: access.vendorId,
        staffId: access.staffId,
        reason: 'noCrewAssignment',
      });
      return emptyStaffWork(access.staffId, query);
    }

    const loaded: PackageVisitRecord[] = [];
    for (const date of staffDates(query)) {
      loaded.push(...await this.plans.listVendorVisitsForDate(access.vendorId, date));
      if (loaded.length > STAFF_WORK_VISIT_CAP) {
        throw new BookingError(
          'SUMMARY_TOO_LARGE',
          'Narrow the date range. Assigned-work totals are not returned for a partial read.',
          409,
          'toDate',
          false,
        );
      }
    }
    const crewIds = new Set(mine.map((crew) => crew.crewId));
    const assigned = assignedToCrews(loaded, access.vendorId, crewIds);
    const enriched = await this.enrich(assigned);
    const page = pageStaffWork({
      staffId: access.staffId,
      crews: mine,
      visits: enriched,
      query,
    });
    this.logger.info({
      event: 'staff_assigned_work_listed',
      vendorId: access.vendorId,
      staffId: access.staffId,
      crewCount: mine.length,
      fromDate: query.fromDate,
      toDate: query.toDate,
      count: page.metrics.assigned,
    });
    return page;
  }

  /** SCHEDULED → IN_PROGRESS for a visit on the caller's active crew. Body identity is ignored. */
  async start(request: LambdaRequest): Promise<StaffVisitActionResult> {
    const assigned = await this.requireAssigned(request);
    const result = await this.packageVisits().applyStart(
      assigned.plan,
      assigned.visit,
      assigned.staffId,
      this.now().toISOString(),
    );
    return toActionResult(result.response, result.idempotent);
  }

  /**
   * IN_PROGRESS → COMPLETED. Idempotency-Key and a checklist body are required.
   * Entitlement is consumed once. Refused while a blocking issue is linked to the visit.
   */
  async complete(request: LambdaRequest): Promise<StaffVisitActionResult> {
    const assigned = await this.requireAssigned(request);
    requireIdempotency(request);
    const input = parseCompleteVisitBody(request.body);
    const result = await this.packageVisits().applyComplete(
      assigned.plan,
      assigned.visit,
      assigned.staffId,
      this.now().toISOString(),
      input,
      userIdOf(request),
    );
    return toActionResult(result.response, result.idempotent);
  }

  /**
   * SCHEDULED → MISSED only after the stored window ends on the server clock.
   * Does not consume entitlement and does not accept a client time.
   */
  async miss(request: LambdaRequest): Promise<StaffVisitActionResult> {
    const assigned = await this.requireAssigned(request);
    const result = await this.packageVisits().applyMiss(assigned.plan, assigned.visit, this.now());
    return toActionResult(result.response, result.idempotent);
  }

  private packageVisits(): PackageVisitsService {
    return this.visits ?? getPackageVisitsService();
  }

  private async requireAssigned(request: LambdaRequest): Promise<{
    staffId: string;
    plan: CustomerPlanRecord;
    visit: PackageVisitRecord;
  }> {
    const userId = userIdOf(request);
    if (!userId) throw new UnauthorizedError('Unauthorized');
    const access = await this.vendors.getOperationalAccess(userId);
    if (access.role !== 'staff' || !access.active || !access.vendorId || !access.staffId) {
      throw new ForbiddenError('Not authorized to update assigned work');
    }
    const visitId = request.pathParameters?.visitId?.trim() ?? '';
    if (!visitId) throw new ValidationError('visitId is required');
    const visit = await this.plans.getVisitById(visitId);
    if (!visit || visit.vendorId !== access.vendorId) throw new NotFoundError('Visit not found');
    const roster = await this.crews.listCrews(access.vendorId);
    const mine = eligibleCrews(roster, access.vendorId, access.staffId);
    const crewId = visit.crewAssignment?.crewId;
    if (!crewId || !mine.some((crew) => crew.crewId === crewId)) {
      throw new ForbiddenError('This visit is not assigned to your crew');
    }
    const plan = await this.plans.getPlan(visit.planId);
    if (!plan || plan.vendorId !== access.vendorId || plan.planId !== visit.planId) {
      throw new NotFoundError('Visit not found');
    }
    return { staffId: access.staffId, plan, visit };
  }

  private async enrich(visits: PackageVisitRecord[]): Promise<PackageVisitRecord[]> {
    const cache = new Map<string, CustomerPlanRecord | null>();
    const planIds = [...new Set(visits.filter((visit) => (
      clockMissing(visit) || !visit.communityId || !visit.registrationNumber
    )).map((visit) => visit.planId))];
    await Promise.all(planIds.filter((planId) => !cache.has(planId)).map(async (planId) => {
      cache.set(planId, await this.plans.getPlan(planId));
    }));
    return visits.map((visit) => enrichVisitFromPlan(visit, cache.get(visit.planId)));
  }
}

let service: StaffAssignedWorkService;

function toActionResult(visit: PackageVisitResponse, idempotent: boolean): StaffVisitActionResult {
  return {
    visitId: visit.visitId,
    status: visit.status,
    ...(visit.startedAt ? { startedAt: visit.startedAt } : {}),
    ...(visit.completedAt ? { completedAt: visit.completedAt } : {}),
    ...(visit.missedAt ? { missedAt: visit.missedAt } : {}),
    entitlementConsumed: visit.entitlementConsumed,
    ...(visit.validationStatus ? { validationStatus: visit.validationStatus } : {}),
    ...(visit.payoutEligible !== undefined ? { payoutEligible: visit.payoutEligible } : {}),
    idempotent,
  };
}

function requireIdempotency(request: LambdaRequest): string {
  const key = headerValue(request, 'Idempotency-Key');
  if (!key || key.length > 128) throw new ValidationError('Idempotency-Key header is required');
  return key;
}

export function getStaffAssignedWorkService(): StaffAssignedWorkService {
  if (!service) service = new StaffAssignedWorkService();
  return service;
}
