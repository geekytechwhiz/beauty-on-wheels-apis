import { ConditionalWriteConflictError, ConflictError, LambdaRequest, NotFoundError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { actorDetails } from '../auth/vendor-operations';
import {
  AssignmentSchedule,
  AssignmentWriteResult,
  DEFAULT_TRAVEL_BUFFER_MINUTES,
  WindowInterval,
  assertCrewAssignable,
  assignmentConflicts,
  buildAssignmentSchedule,
  hashAssignmentRequest,
  newScheduleId,
  occupiedFromVisits,
  parseAssignmentCommand,
  parseAssignmentRange,
  sameRangeAssignment,
  scheduleAndAssignVisit,
  travelWarningsFor,
  visitEligible,
  windowInterval,
  workloadFor,
  consensusInterval,
} from '../domain/crew-assignment';
import { computeVisitProgress, enrichVisitFromPlan, withoutCrewAssignment } from '../domain/package-visit';
import { SUMMARY_VISIT_CAP, addCalendarDays } from '../domain/vendor-package-visits';
import { BookingError } from '../errors';
import { requireIdempotencyKey } from '../http/idempotency';
import { SchedulingCrewGateway, getSchedulingCrewGateway } from '../integrations/scheduling-crews.client';
import { OperationalAccessGateway, getOperationalAccessGateway } from '../integrations/vendor.client';
import {
  CustomerPlansRepository,
  buildScheduleIdempotencyItem,
  getCustomerPlansRepository,
} from '../repositories/customer-plans.repository';
import { CustomerPlanRecord } from '../types/customer-plan.types';
import { PACKAGE_VISIT_STATUS, PackageVisitRecord } from '../types/package-visit.types';
import { env } from '../configs/env.config';

const baseLogger = createLogger({ service: 'crew-assignments', redactPII: true });

export class CrewAssignmentsService {
  private readonly logger = createChildLogger(baseLogger, { service: 'CrewAssignmentsService' });

  constructor(
    private readonly plans: CustomerPlansRepository = getCustomerPlansRepository(),
    private readonly vendors: OperationalAccessGateway = getOperationalAccessGateway(),
    private readonly crews: SchedulingCrewGateway = getSchedulingCrewGateway(),
    private readonly now: () => Date = () => new Date(),
    private readonly travelBufferMinutes: number = travelBufferFromEnv(),
  ) {}

  async list(request: LambdaRequest): Promise<AssignmentSchedule> {
    const vendorId = pathVendorId(request);
    await actorDetails(request, vendorId, this.vendors);
    const range = parseAssignmentRange(queryOf(request), this.now());
    const loaded = await this.loadRange(vendorId, range.fromDate, range.toDate);
    return buildAssignmentSchedule({
      ...range,
      travelBufferMinutes: this.travelBufferMinutes,
      visits: loaded.visits,
      intervals: loaded.intervals,
      crews: await this.crews.listCrews(vendorId),
    });
  }

  /**
   * Canonical manager action for Carish community planning:
   * schedule selected UNSCHEDULED (or reschedule SCHEDULED) package visits into a
   * date range + visit window and assign them to a crew in one transaction.
   *
   * Does not call Availability. Exact arrival times, towers, floors, and vehicle
   * order are intentionally out of scope — the team decides order on site.
   */
  async assign(request: LambdaRequest): Promise<AssignmentWriteResult> {
    const vendorId = pathVendorId(request);
    const actor = await actorDetails(request, vendorId, this.vendors);
    const idempotencyKey = requireIdempotencyKey(request);
    const command = parseAssignmentCommand(request.body);
    const requestHash = hashAssignmentRequest(command);

    const existing = await this.plans.getScheduleIdempotency(vendorId, idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictError('Idempotency-Key was reused with a different request');
      }
      return existing.result as AssignmentWriteResult;
    }

    const roster = await this.crews.listCrews(vendorId);
    const crew = roster.find((item) => item.crewId === command.crewId && item.vendorId === vendorId);
    if (!crew) throw new NotFoundError('Crew not found');
    const staffIds = assertCrewAssignable(crew);

    const visits = await this.loadCommandVisits(command.visitIds);
    const plans = await this.plansFor(visits);
    const enriched = visits.map((visit) => enrichVisitFromPlan(visit, plans.get(visit.planId)));

    for (const visit of enriched) {
      visitEligible(visit, command, vendorId);
      const plan = plans.get(visit.planId);
      if (!plan || plan.paymentStatus !== 'PAID') {
        throw new BookingError(
          'VISIT_NOT_ASSIGNABLE',
          'Visit is not an active paid-plan entitlement',
          409,
          'visitId',
          false,
        );
      }
    }

    if (enriched.every((visit) => sameRangeAssignment(visit, command))) {
      const scheduleId = enriched[0].scheduleId ?? newScheduleId();
      return this.toWriteResult({
        scheduleId,
        command,
        visits: enriched,
        idempotent: true,
        workload: workloadFor(
          enriched.map((visit) => visit.durationMinutes),
          consensusInterval(enriched.map((visit) => this.intervalFor(visit, plans.get(visit.planId)))),
        ),
        travelWarnings: [],
      });
    }

    const intervals = new Map(enriched.map((visit) => [visit.visitId, this.intervalFor(visit, plans.get(visit.planId))]));
    const targetInterval = consensusInterval([...intervals.values()]);
    const neighbors = await this.loadRange(
      vendorId,
      addCalendarDays(command.scheduleStartDate, -1),
      addCalendarDays(command.scheduleEndDate, 1),
    );
    const moving = new Set(command.visitIds);
    const staying = neighbors.visits.filter((visit) => !moving.has(visit.visitId));

    const others = occupiedFromVisits(staying, neighbors.intervals, roster);
    const conflicts = assignmentConflicts({
      target: {
        date: command.scheduleStartDate,
        scheduleStartDate: command.scheduleStartDate,
        scheduleEndDate: command.scheduleEndDate,
        communityId: command.communityId,
        visitWindowId: command.visitWindowId,
        crewId: command.crewId,
        staffIds,
        interval: targetInterval,
      },
      others,
    });
    if (conflicts.length > 0) {
      throw new BookingError(conflicts[0].code, conflicts[0].message, 409, 'crewId', false);
    }

    const now = this.now().toISOString();
    const scheduleId = newScheduleId();
    const updates = enriched.map((visit) => ({
      next: scheduleAndAssignVisit({
        visit,
        command,
        scheduleId,
        actorId: actor.userId,
        now,
      }),
      expectedVersion: visit.version,
      fromStatus: (visit.status === PACKAGE_VISIT_STATUS.SCHEDULED
        ? PACKAGE_VISIT_STATUS.SCHEDULED
        : PACKAGE_VISIT_STATUS.UNSCHEDULED) as 'UNSCHEDULED' | 'SCHEDULED',
    }));

    const resultingVisits = updates.map((update) => update.next);
    const workload = workloadFor(
      resultingVisits.map((visit) => visit.durationMinutes),
      targetInterval,
    );
    const projected = occupiedFromVisits(
      [...staying, ...resultingVisits],
      new Map([...neighbors.intervals, ...intervals]),
      roster,
    );
    const travelWarnings = travelWarningsFor(projected, this.travelBufferMinutes)
      .filter((warning) => warning.crewId === command.crewId);

    const result = this.toWriteResult({
      scheduleId,
      command,
      visits: resultingVisits,
      idempotent: false,
      workload,
      travelWarnings,
    });

    try {
      await this.plans.saveScheduleAssignments({
        updates,
        idempotency: buildScheduleIdempotencyItem({
          vendorId,
          idempotencyKey,
          requestHash,
          result: result as unknown as Record<string, unknown>,
          createdAt: now,
        }),
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const raced = await this.plans.getScheduleIdempotency(vendorId, idempotencyKey);
        if (raced && raced.requestHash === requestHash) {
          return raced.result as AssignmentWriteResult;
        }
        throw new BookingError(
          'ASSIGNMENT_CONFLICT',
          'A visit changed while it was being scheduled. Reload and retry',
          409,
          'visitId',
          true,
        );
      }
      throw error;
    }

    await this.refreshPlans(enriched.map((visit) => visit.planId));

    this.logger.info({
      event: 'package_visits_schedule_assigned',
      vendorId,
      scheduleId,
      crewId: command.crewId,
      visitCount: command.visitIds.length,
      scheduleStartDate: command.scheduleStartDate,
      scheduleEndDate: command.scheduleEndDate,
      idempotencyKey,
    });
    return result;
  }

  async remove(request: LambdaRequest): Promise<{
    visitId: string;
    crewId: string;
    idempotent: boolean;
  }> {
    const vendorId = pathVendorId(request);
    const actor = await actorDetails(request, vendorId, this.vendors);
    const visitId = request.pathParameters?.visitId?.trim() ?? '';
    if (!visitId) throw new BookingError('VISIT_NOT_FOUND', 'Visit not found', 404, 'visitId', false);
    const visit = await this.plans.getVisitById(visitId);
    if (!visit) throw new NotFoundError('Visit not found');
    if (visit.vendorId !== vendorId) {
      throw new BookingError('CROSS_VENDOR_VISIT', 'Visit belongs to a different vendor', 403, 'visitId', false);
    }
    if (!visit.crewAssignment) {
      return { visitId, crewId: '', idempotent: true };
    }
    if (visit.status !== PACKAGE_VISIT_STATUS.SCHEDULED) {
      throw new BookingError(
        'VISIT_NOT_ASSIGNABLE',
        `A ${visit.status} visit assignment cannot be removed`,
        409,
        'visitId',
        false,
      );
    }
    const now = this.now().toISOString();
    const crewId = visit.crewAssignment.crewId;
    const next = withoutCrewAssignment({ ...visit, updatedAt: now, version: visit.version + 1 });
    try {
      await this.plans.saveVisits([{ next, expectedVersion: visit.version }]);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new BookingError(
          'ASSIGNMENT_CONFLICT',
          'A visit changed while it was being assigned. Reload and retry',
          409,
          'visitId',
          true,
        );
      }
      throw error;
    }
    this.logger.info({ event: 'crew_assignment_removed', vendorId, visitId, actorId: actor.userId });
    return { visitId, crewId, idempotent: false };
  }

  private toWriteResult(input: {
    scheduleId: string;
    command: ReturnType<typeof parseAssignmentCommand>;
    visits: PackageVisitRecord[];
    idempotent: boolean;
    workload: ReturnType<typeof workloadFor>;
    travelWarnings: ReturnType<typeof travelWarningsFor>;
  }): AssignmentWriteResult {
    return {
      scheduleId: input.scheduleId,
      communityId: input.command.communityId,
      scheduleStartDate: input.command.scheduleStartDate,
      scheduleEndDate: input.command.scheduleEndDate,
      visitWindowId: input.command.visitWindowId,
      crewId: input.command.crewId,
      status: PACKAGE_VISIT_STATUS.SCHEDULED,
      scheduledVisitCount: input.visits.length,
      visits: input.visits.map((visit) => ({
        visitId: visit.visitId,
        status: PACKAGE_VISIT_STATUS.SCHEDULED,
        crewId: input.command.crewId,
      })),
      idempotent: input.idempotent,
      workload: input.workload,
      travelWarnings: input.travelWarnings,
      capacityAdvisory: input.workload.overloaded === true,
    };
  }

  private async refreshPlans(planIds: string[]): Promise<void> {
    const unique = [...new Set(planIds)];
    await Promise.all(unique.map(async (planId) => {
      const plan = await this.plans.getPlan(planId);
      if (!plan) return;
      const visits = await this.plans.listVisits(planId);
      const progress = computeVisitProgress(visits);
      await this.plans.savePlan({
        ...plan,
        visitProgress: progress,
        scheduleState: progress.scheduleState,
        remainingVisits: progress.remainingVisits,
        updatedAt: this.now().toISOString(),
        version: plan.version + 1,
      }, plan.version).catch(() => undefined);
    }));
  }

  private async loadCommandVisits(visitIds: string[]): Promise<PackageVisitRecord[]> {
    const visits = await Promise.all(visitIds.map((visitId) => this.plans.getVisitById(visitId)));
    return visits.map((visit, index) => {
      if (!visit) throw new NotFoundError(`Visit ${visitIds[index]} not found`);
      return visit;
    });
  }

  private async loadRange(vendorId: string, fromDate: string, toDate: string): Promise<{
    visits: PackageVisitRecord[];
    intervals: Map<string, WindowInterval>;
  }> {
    const visits: PackageVisitRecord[] = [];
    for (const date of [fromDate, ...datesBetween(fromDate, toDate)]) {
      visits.push(...await this.plans.listVendorVisitsForDate(vendorId, date));
      if (visits.length > SUMMARY_VISIT_CAP) {
        throw new BookingError(
          'SUMMARY_TOO_LARGE',
          'Narrow the date range. Assignments are not returned for a partial read.',
          409,
          'toDate',
          false,
        );
      }
    }
    const unique = [...new Map(visits.map((visit) => [visit.visitId, visit])).values()];
    const plans = await this.plansFor(unique);
    const enriched = unique.map((visit) => enrichVisitFromPlan(visit, plans.get(visit.planId)));
    return {
      visits: enriched,
      intervals: new Map(enriched.map((visit) => [visit.visitId, this.intervalFor(visit, plans.get(visit.planId))])),
    };
  }

  private async plansFor(visits: PackageVisitRecord[]): Promise<Map<string, CustomerPlanRecord | null>> {
    const cache = new Map<string, CustomerPlanRecord | null>();
    const planIds = [...new Set(visits.map((visit) => visit.planId))];
    await Promise.all(planIds.map(async (planId) => {
      cache.set(planId, await this.plans.getPlan(planId));
    }));
    return cache;
  }

  private intervalFor(visit: PackageVisitRecord, plan: CustomerPlanRecord | null | undefined): WindowInterval {
    return windowInterval(plan?.visitWindow, visit.visitWindowId ?? '');
  }
}

function datesBetween(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  let cursor = fromDate;
  while (cursor < toDate) {
    cursor = addCalendarDays(cursor, 1);
    dates.push(cursor);
  }
  return dates;
}

function travelBufferFromEnv(): number {
  const parsed = Number(env.TRAVEL_BUFFER_MINUTES);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_TRAVEL_BUFFER_MINUTES;
}

function pathVendorId(request: LambdaRequest): string {
  return request.pathParameters?.vendorId?.trim() ?? '';
}

/**
 * API Gateway query values arrive on `params` after the request middleware.
 * Tests and older handlers also set `query` or `queryStringParameters`.
 */
function queryOf(request: LambdaRequest): Record<string, string | undefined> {
  const loose = request as LambdaRequest & {
    query?: Record<string, unknown> | null;
    queryStringParameters?: Record<string, unknown> | null;
  };
  const merged: Record<string, string | undefined> = {};
  for (const source of [loose.query, loose.queryStringParameters, loose.params]) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (merged[key] !== undefined) continue;
      if (typeof value === 'string') merged[key] = value;
    }
  }
  return merged;
}

let service: CrewAssignmentsService;

export function getCrewAssignmentsService(): CrewAssignmentsService {
  if (!service) service = new CrewAssignmentsService();
  return service;
}
