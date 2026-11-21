import { LambdaRequest, ValidationError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { assertAdmin } from '../auth/admin';
import {
  DemandBucket,
  DemandWindowBucket,
  MAX_DEMAND_VISITS,
  aggregateDemand,
  demandDates,
  requireIsoDate,
  visitSlotUnits,
} from '../domain/ops-supply-demand';
import { decodeVisitToken, encodeVisitToken } from '../domain/vendor-package-visits';
import { requestQuery } from '../http/request-query';
import { CustomerPlansRepository, getCustomerPlansRepository } from '../repositories/customer-plans.repository';
import { PACKAGE_VISIT_STATUS, PackageVisitRecord, PackageVisitStatus } from '../types/package-visit.types';

const baseLogger = createLogger({ service: 'ops-dispatch', redactPII: true });
const PAGE_READ = 100;
const MAX_READS = 20;
const DISPATCH_STATUSES = new Set<string>(Object.values(PACKAGE_VISIT_STATUS));

const DEMAND_DEFINITION =
  'Booked package-visit demand for a community and date range. demandVisits counts scheduled, in-progress, completed, and missed visits. demandSlotUnits is the same 30-minute unit as Vendor Service commitment.quantity. Cancelled visits are reported separately and are not demand. Unscheduled entitlements are excluded. This is not committed vendor supply and not bookable availability.';

const DISPATCH_DEFINITION =
  'Operations dispatch queue of scheduled package visits across vendors. Crew fields are visit assignment, not capacity allocation. Rows written before the operations schedule index are absent until they are saved again.';

export class OpsDispatchService {
  private readonly logger = createChildLogger(baseLogger, { service: 'OpsDispatchService' });

  constructor(
    private readonly plans: CustomerPlansRepository = getCustomerPlansRepository(),
  ) {}

  async listDispatch(request: LambdaRequest) {
    const started = Date.now();
    const adminId = assertAdmin(request);
    const query = requestQuery(request);
    const date = requireIsoDate(query.date, 'date');
    const communityId = optional(query.communityId);
    const visitWindowId = optional(query.visitWindowId);
    const vendorId = optional(query.vendorId);
    const status = parseStatus(query.status);
    const search = optional(query.search)?.toUpperCase();
    const limit = parseLimit(query.limit);
    const cursor = decodeVisitToken(query.cursor ?? query.nextToken);
    const items: ReturnType<typeof toDispatchVisit>[] = [];
    let exclusiveStartKey = cursor;
    let nextCursor: string | null = null;

    for (let read = 0; read < MAX_READS && items.length < limit; read += 1) {
      const page = await this.plans.queryOpsSchedule({
        date,
        ...(communityId ? { communityId } : {}),
        ...(visitWindowId ? { visitWindowId } : {}),
        limit: PAGE_READ,
        ...(exclusiveStartKey ? { exclusiveStartKey } : {}),
      });
      let filled = false;
      for (let index = 0; index < page.items.length; index += 1) {
        const visit = page.items[index].record;
        if (!matchesDispatch(visit, { vendorId, status, search })) continue;
        items.push(toDispatchVisit(visit));
        if (items.length >= limit) {
          const moreInPage = index < page.items.length - 1;
          nextCursor = moreInPage
            ? encodeVisitToken(page.items[index]?.resumeKey)
            : encodeVisitToken(page.lastEvaluatedKey);
          filled = true;
          break;
        }
      }
      if (filled) break;
      if (!page.lastEvaluatedKey) {
        nextCursor = null;
        break;
      }
      exclusiveStartKey = page.lastEvaluatedKey;
      nextCursor = encodeVisitToken(page.lastEvaluatedKey);
    }

    this.logger.info({
      event: 'ops_dispatch_listed',
      correlationId: correlationIdOf(request),
      service: 'booking-service',
      operation: 'GET /ops/dispatch/package-visits',
      outcome: 'success',
      durationMs: Date.now() - started,
      count: items.length,
      actorId: adminId,
      date,
      communityId,
      vendorId,
    });
    return {
      definition: DISPATCH_DEFINITION,
      items,
      pagination: {
        limit,
        nextCursor,
        hasMore: Boolean(nextCursor),
        total: null,
        totalAvailability: 'unavailable' as const,
        totalReason: 'This is one page of the dispatch queue. items.length is not the day’s visit population.',
      },
      coverage: {
        source: 'packageVisitOpsScheduleIndex',
        includesVisitsWrittenBeforeIndex: false,
        reason: 'Only package visits saved with the operations schedule index are listed. Per-vendor GET /vendors/{vendorId}/package-visits remains the vendor-scoped read.',
      },
    };
  }

  async readDemand(request: LambdaRequest) {
    const started = Date.now();
    const adminId = assertAdmin(request);
    const query = requestQuery(request);
    const communityId = optional(query.communityId);
    if (!communityId) throw new ValidationError('communityId is required');
    const fromDate = requireIsoDate(query.fromDate, 'fromDate');
    const toDate = requireIsoDate(query.toDate, 'toDate');
    const visitWindowId = optional(query.visitWindowId);
    const dates = demandDates(fromDate, toDate);
    const visits: PackageVisitRecord[] = [];
    let truncated = false;

    for (const date of dates) {
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const page = await this.plans.queryOpsSchedule({
          date,
          communityId,
          ...(visitWindowId ? { visitWindowId } : {}),
          limit: PAGE_READ,
          ...(exclusiveStartKey ? { exclusiveStartKey } : {}),
        });
        visits.push(...page.items.map((row) => row.record));
        if (visits.length > MAX_DEMAND_VISITS) {
          truncated = true;
          break;
        }
        exclusiveStartKey = page.lastEvaluatedKey;
      } while (exclusiveStartKey);
      if (truncated) break;
    }

    const aggregated = truncated ? null : aggregateDemand(visits);
    this.logger.info({
      event: 'ops_demand_read',
      correlationId: correlationIdOf(request),
      service: 'booking-service',
      operation: 'GET /ops/demand/package-visits',
      outcome: truncated ? 'unavailable' : 'success',
      durationMs: Date.now() - started,
      count: truncated ? null : visits.length,
      actorId: adminId,
      communityId,
      fromDate,
      toDate,
    });
    return {
      communityId,
      fromDate,
      toDate,
      ...(visitWindowId ? { visitWindowId } : {}),
      definition: DEMAND_DEFINITION,
      unit: {
        name: 'slotUnit' as const,
        minutes: 30,
        compareWith: 'Vendor Service capacity commitment quantity for the same community and an overlapping service window. Do not compare with availability slots or onboarding estimates.',
      },
      completeness: truncated ? 'unavailable' as const : 'indexedRows' as const,
      completenessReason: truncated
        ? `More than ${MAX_DEMAND_VISITS} indexed visits match this range. Totals are omitted rather than returned as a partial population. Narrow the date range or visit window.`
        : 'Totals include scheduled package visits saved with the operations schedule index. Visits written before that index are omitted, so a gap calculated from this response is unavailable until those visits are rewritten.',
      totals: aggregated?.totals ?? null,
      byWindow: aggregated?.byWindow ?? [],
    };
  }
}

function matchesDispatch(
  visit: PackageVisitRecord,
  filters: { vendorId?: string; status?: PackageVisitStatus; search?: string },
): boolean {
  if (filters.vendorId && visit.vendorId !== filters.vendorId) return false;
  if (filters.status && visit.status !== filters.status) return false;
  if (!filters.search) return true;
  const haystack = [visit.registrationNumber, visit.serviceName, visit.visitId]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  return haystack.includes(filters.search);
}

function toDispatchVisit(visit: PackageVisitRecord) {
  return {
    visitId: visit.visitId,
    planId: visit.planId,
    vendorId: visit.vendorId,
    ...(visit.communityId ? { communityId: visit.communityId } : {}),
    ...(visit.visitWindowId ? { visitWindowId: visit.visitWindowId } : {}),
    ...(visit.visitWindowName ? { visitWindowName: visit.visitWindowName } : {}),
    status: visit.status,
    scheduledDate: visit.schedule?.date ?? visit.scheduleStartDate,
    ...(visit.scheduleStartDate ? { scheduleStartDate: visit.scheduleStartDate } : {}),
    ...(visit.scheduleEndDate ? { scheduleEndDate: visit.scheduleEndDate } : {}),
    startTime: visit.schedule?.startTime,
    endTime: visit.schedule?.endTime,
    serviceName: visit.serviceName,
    durationMinutes: visit.durationMinutes,
    slotUnits: visitSlotUnits(visit.durationMinutes),
    ...(visit.registrationNumber ? { registrationNumber: visit.registrationNumber } : {}),
    assignedCrew: visit.crewAssignment
      ? { crewId: visit.crewAssignment.crewId, assignedAt: visit.crewAssignment.assignedAt }
      : null,
  };
}

function parseStatus(value: string | undefined): PackageVisitStatus | undefined {
  const status = value?.trim();
  if (!status) return undefined;
  if (!DISPATCH_STATUSES.has(status)) throw new ValidationError(`Invalid status: ${status}`);
  return status as PackageVisitStatus;
}

function parseLimit(value: string | undefined): number {
  if (!value?.trim()) return 50;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ValidationError('limit must be an integer from 1 to 100');
  }
  return limit;
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function correlationIdOf(request: LambdaRequest): string | undefined {
  return (request.context as { correlationId?: string } | undefined)?.correlationId;
}

let service: OpsDispatchService | undefined;
export function getOpsDispatchService(): OpsDispatchService {
  if (!service) service = new OpsDispatchService();
  return service;
}

export type OpsDemandTotals = DemandBucket | null;
export type OpsDemandWindows = DemandWindowBucket[];
