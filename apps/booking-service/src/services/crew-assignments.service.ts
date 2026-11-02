import { ConditionalWriteConflictError, LambdaRequest, NotFoundError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { assertVendorOperationsAccess } from '../auth/vendor-operations';
import {
  AssignmentSchedule,
  AssignmentWriteResult,
  DEFAULT_TRAVEL_BUFFER_MINUTES,
  WindowInterval,
  assertCrewAssignable,
  assignVisit,
  assignmentConflicts,
  buildAssignmentSchedule,
  occupiedFromVisits,
  parseAssignmentCommand,
  parseAssignmentRange,
  sameAssignment,
  travelWarningsFor,
  visitEligible,
  windowInterval,
  workloadFor,
  consensusInterval,
} from '../domain/crew-assignment';
import { enrichVisitFromPlan, withoutCrewAssignment } from '../domain/package-visit';
import { SUMMARY_VISIT_CAP, addCalendarDays } from '../domain/vendor-package-visits';
import { BookingError } from '../errors';
import { SchedulingCrewGateway, getSchedulingCrewGateway } from '../integrations/scheduling-crews.client';
import { OperationalAccessGateway, getOperationalAccessGateway } from '../integrations/vendor.client';
import { CustomerPlansRepository, getCustomerPlansRepository } from '../repositories/customer-plans.repository';
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
    await assertVendorOperationsAccess(request, vendorId, this.vendors);
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
   * Does not reserve Availability capacity. Scheduling already calls
   * AvailabilityGateway.reserveBooking with the visit id, and that contract
   * has no crew id. Calling it again would reserve the same visit twice.
   * This method checks crew, staff, community, and visit-window overlap only.
   * capacityAdvisory compares durations with the stored window. It does not
   * change slot capacity. Removing an assignment does not release the reservation.
   */
  async assign(request: LambdaRequest): Promise<AssignmentWriteResult> {
    const vendorId = pathVendorId(request);
    const actor = await assertVendorOperationsAccess(request, vendorId, this.vendors);
    const command = parseAssignmentCommand(request.body);
    if (command.mode === 'unassign') return this.unassignMany(vendorId, actor.userId, command);

    const roster = await this.crews.listCrews(vendorId);
    const crew = roster.find((item) => item.crewId === command.crewId && item.vendorId === vendorId);
    if (!crew) throw new NotFoundError('Crew not found');
    const staffIds = assertCrewAssignable(crew);

    const visits = await this.loadCommandVisits(command.visitIds);
    const plans = await this.plansFor(visits);
    const enriched = visits.map((visit) => enrichVisitFromPlan(visit, plans.get(visit.planId)));
    enriched.forEach((visit) => visitEligible(visit, command, vendorId));

    const intervals = new Map(enriched.map((visit) => [visit.visitId, this.intervalFor(visit, plans.get(visit.planId))]));
    const targetInterval = consensusInterval([...intervals.values()]);
    const neighbors = await this.loadRange(
      vendorId,
      addCalendarDays(command.scheduledDate, -1),
      addCalendarDays(command.scheduledDate, 1),
    );
    const moving = new Set(command.visitIds);
    const staying = neighbors.visits.filter((visit) => !moving.has(visit.visitId));
    for (const visit of enriched) {
      if (visit.crewAssignment && visit.crewAssignment.crewId !== command.crewId && !command.replaceExisting) {
        throw new BookingError(
          'CREW_ASSIGNMENT_CONFLICT',
          'Visit is already assigned to another crew',
          409,
          'visitId',
          false,
        );
      }
    }

    const others = occupiedFromVisits(staying, neighbors.intervals, roster);
    const conflicts = assignmentConflicts({
      target: {
        date: command.scheduledDate,
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
    const updates = enriched.flatMap((visit) => {
      if (sameAssignment(visit, command.crewId)) return [];
      return [{
        next: assignVisit(visit, command.crewId, actor.userId, now),
        expectedVersion: visit.version,
      }];
    });
    await this.persist(updates);

    const resulting = [
      ...staying.filter((visit) => (
        visit.crewAssignment?.crewId === command.crewId
        && visit.schedule?.date === command.scheduledDate
        && visit.communityId === command.communityId
        && visit.visitWindowId === command.visitWindowId
      )),
      ...enriched,
    ];
    const workload = workloadFor(
      resulting
        .filter((visit) => visit.status === PACKAGE_VISIT_STATUS.SCHEDULED
          || visit.status === PACKAGE_VISIT_STATUS.IN_PROGRESS
          || visit.status === PACKAGE_VISIT_STATUS.COMPLETED)
        .map((visit) => visit.durationMinutes),
      targetInterval,
    );
    const projected = occupiedFromVisits(
      [...staying, ...enriched.map((visit) => (
        sameAssignment(visit, command.crewId) ? visit : assignVisit(visit, command.crewId, actor.userId, now)
      ))],
      new Map([...neighbors.intervals, ...intervals]),
      roster,
    );
    const travelWarnings = travelWarningsFor(projected, this.travelBufferMinutes)
      .filter((warning) => warning.crewId === command.crewId);

    this.logger.info({
      event: 'crew_assignment_saved',
      vendorId,
      crewId: command.crewId,
      visitCount: command.visitIds.length,
      idempotent: updates.length === 0,
    });
    return {
      scheduledDate: command.scheduledDate,
      communityId: command.communityId,
      visitWindowId: command.visitWindowId,
      crewId: command.crewId,
      visitIds: command.visitIds,
      idempotent: updates.length === 0,
      workload,
      travelWarnings,
      capacityAdvisory: workload.overloaded === true,
    };
  }

  async remove(request: LambdaRequest): Promise<AssignmentWriteResult> {
    const vendorId = pathVendorId(request);
    const actor = await assertVendorOperationsAccess(request, vendorId, this.vendors);
    const visitId = request.pathParameters?.visitId?.trim() ?? '';
    if (!visitId) throw new BookingError('VISIT_NOT_FOUND', 'Visit not found', 404, 'visitId', false);
    const visit = await this.plans.getVisitById(visitId);
    if (!visit) throw new NotFoundError('Visit not found');
    if (visit.vendorId !== vendorId) {
      throw new BookingError('CROSS_VENDOR_VISIT', 'Visit belongs to a different vendor', 403, 'visitId', false);
    }
    if (!visit.crewAssignment) {
      return emptyRemoval(visit, true);
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
    const next = withoutCrewAssignment({ ...visit, updatedAt: now, version: visit.version + 1 });
    await this.persist([{ next, expectedVersion: visit.version }]);
    this.logger.info({ event: 'crew_assignment_removed', vendorId, visitId, actorId: actor.userId });
    return emptyRemoval(visit, false);
  }

  private async unassignMany(
    vendorId: string,
    actorId: string,
    command: ReturnType<typeof parseAssignmentCommand>,
  ): Promise<AssignmentWriteResult> {
    const visits = await this.loadCommandVisits(command.visitIds);
    const plans = await this.plansFor(visits);
    const enriched = visits.map((visit) => enrichVisitFromPlan(visit, plans.get(visit.planId)));
    const now = this.now().toISOString();
    const updates = enriched.flatMap((visit) => {
      if (visit.vendorId !== vendorId) {
        throw new BookingError('CROSS_VENDOR_VISIT', 'Visit belongs to a different vendor', 403, 'visitId', false);
      }
      if (visit.schedule?.date !== command.scheduledDate
        || visit.communityId !== command.communityId
        || visit.visitWindowId !== command.visitWindowId) {
        throw new BookingError('VISIT_NOT_ASSIGNABLE', 'Visit is not in the requested group', 409, 'visitId', false);
      }
      if (!visit.crewAssignment) return [];
      if (visit.crewAssignment.crewId !== command.crewId) {
        throw new BookingError(
          'CREW_ASSIGNMENT_CONFLICT',
          'Visit is assigned to a different crew',
          409,
          'visitId',
          false,
        );
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
      return [{
        next: withoutCrewAssignment({ ...visit, updatedAt: now, version: visit.version + 1 }),
        expectedVersion: visit.version,
      }];
    });
    await this.persist(updates);
    this.logger.info({
      event: 'crew_assignment_removed',
      vendorId,
      crewId: command.crewId,
      visitCount: updates.length,
      actorId,
    });
    return {
      scheduledDate: command.scheduledDate,
      communityId: command.communityId,
      visitWindowId: command.visitWindowId,
      crewId: command.crewId,
      visitIds: command.visitIds,
      idempotent: updates.length === 0,
      workload: workloadFor([], { known: false, allDay: false }),
      travelWarnings: [],
      capacityAdvisory: false,
    };
  }

  private async persist(updates: Array<{ next: PackageVisitRecord; expectedVersion: number }>): Promise<void> {
    if (updates.length === 0) return;
    try {
      await this.plans.saveVisits(updates);
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

function emptyRemoval(visit: PackageVisitRecord, idempotent: boolean): AssignmentWriteResult {
  return {
    scheduledDate: visit.schedule?.date ?? '',
    communityId: visit.communityId ?? '',
    visitWindowId: visit.visitWindowId ?? '',
    crewId: visit.crewAssignment?.crewId ?? '',
    visitIds: [visit.visitId],
    idempotent,
    workload: workloadFor([], { known: false, allDay: false }),
    travelWarnings: [],
    capacityAdvisory: false,
  };
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
