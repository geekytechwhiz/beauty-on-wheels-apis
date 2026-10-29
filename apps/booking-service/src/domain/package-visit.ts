import { randomUUID } from 'crypto';

import { BookingError } from '../errors';
import {
  CustomerPlanRecord,
  PlanEntitlement,
  PlanIncludedService,
} from '../types/customer-plan.types';
import {
  PACKAGE_SCHEDULE_STATE,
  PACKAGE_VISIT_STATUS,
  PackageScheduleState,
  PackageVisitProgress,
  PackageVisitRecord,
  PackageVisitResponse,
  PackageVisitSchedule,
  PackageVisitScheduleHistoryEntry,
  PackageVisitStatus,
} from '../types/package-visit.types';

const ALLOWED_TRANSITIONS: Record<PackageVisitStatus, readonly PackageVisitStatus[]> = {
  UNSCHEDULED: [PACKAGE_VISIT_STATUS.SCHEDULED, PACKAGE_VISIT_STATUS.CANCELLED],
  SCHEDULED: [
    PACKAGE_VISIT_STATUS.IN_PROGRESS,
    PACKAGE_VISIT_STATUS.CANCELLED,
    PACKAGE_VISIT_STATUS.MISSED,
    PACKAGE_VISIT_STATUS.SCHEDULED, // reschedule keeps SCHEDULED
  ],
  IN_PROGRESS: [PACKAGE_VISIT_STATUS.COMPLETED, PACKAGE_VISIT_STATUS.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
  MISSED: [],
};

export function assertVisitTransition(
  from: PackageVisitStatus,
  to: PackageVisitStatus,
): void {
  if (from === to && to === PACKAGE_VISIT_STATUS.SCHEDULED) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new BookingError(
      'INVALID_VISIT_TRANSITION',
      `Cannot transition visit from ${from} to ${to}`,
      409,
      'status',
      false,
    );
  }
}

export interface MaterializeVisitInput {
  plan: CustomerPlanRecord;
  now: string;
}

/** Plan fields the vendor list can filter without reading another service. */
export function operationalSnapshot(plan: CustomerPlanRecord): Pick<
  PackageVisitRecord,
  | 'communityId'
  | 'visitWindowId'
  | 'visitWindowName'
  | 'vehicleId'
  | 'vehicleType'
  | 'registrationNumber'
  | 'vehicleDisplayName'
> {
  return {
    ...(plan.location.communityId ? { communityId: plan.location.communityId } : {}),
    ...(plan.visitWindowId ? { visitWindowId: plan.visitWindowId } : {}),
    ...(plan.visitWindow?.label ? { visitWindowName: plan.visitWindow.label } : {}),
    ...(plan.vehicleId ? { vehicleId: plan.vehicleId } : {}),
    ...(plan.vehicleType ? { vehicleType: plan.vehicleType } : {}),
    ...(plan.vehicleRegistrationNumber
      ? { registrationNumber: plan.vehicleRegistrationNumber.trim().toUpperCase() }
      : {}),
    ...(plan.vehicleDisplayName ? { vehicleDisplayName: plan.vehicleDisplayName } : {}),
  };
}

/** Fills snapshot fields from the parent plan when the visit row predates the snapshot. */
export function enrichVisitFromPlan(
  visit: PackageVisitRecord,
  plan: CustomerPlanRecord | null | undefined,
): PackageVisitRecord {
  if (!plan || plan.planId !== visit.planId || plan.vendorId !== visit.vendorId) return visit;
  const snapshot = operationalSnapshot(plan);
  return {
    ...visit,
    communityId: visit.communityId ?? snapshot.communityId,
    visitWindowId: visit.visitWindowId ?? snapshot.visitWindowId,
    visitWindowName: visit.visitWindowName ?? snapshot.visitWindowName,
    vehicleId: visit.vehicleId ?? snapshot.vehicleId,
    vehicleType: visit.vehicleType ?? snapshot.vehicleType,
    registrationNumber: visit.registrationNumber ?? snapshot.registrationNumber,
    vehicleDisplayName: visit.vehicleDisplayName ?? snapshot.vehicleDisplayName,
  };
}

/**
 * One visit row per entitlement unit. Prefer includedServices (name + duration)
 * keyed by entitlement serviceId; fall back to entitlement-only rows.
 */
export function materializePackageVisits(input: MaterializeVisitInput): PackageVisitRecord[] {
  const { plan, now } = input;
  const durationByService = durationLookup(plan.includedServices, plan.entitlements);
  const nameByService = nameLookup(plan.includedServices, plan.entitlements);
  const visits: PackageVisitRecord[] = [];
  let ordinal = 0;

  for (const entitlement of plan.entitlements) {
    for (let sequence = 1; sequence <= entitlement.quantity; sequence += 1) {
      ordinal += 1;
      visits.push({
        visitId: randomUUID(),
        planId: plan.planId,
        customerId: plan.customerId,
        vendorId: plan.vendorId,
        ...operationalSnapshot(plan),
        serviceId: entitlement.serviceId,
        serviceName: nameByService.get(entitlement.serviceId) ?? entitlement.serviceId,
        sequence,
        ordinal,
        status: PACKAGE_VISIT_STATUS.UNSCHEDULED,
        durationMinutes: durationByService.get(entitlement.serviceId) ?? 30,
        scheduleHistory: [],
        entitlementConsumed: false,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return visits;
}

function durationLookup(
  included: PlanIncludedService[] | undefined,
  entitlements: PlanEntitlement[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of included ?? []) {
    const key = entry.serviceKey ?? entry.name;
    if (!map.has(key)) map.set(key, entry.durationMinutes);
  }
  for (const entitlement of entitlements) {
    if (!map.has(entitlement.serviceId)) map.set(entitlement.serviceId, 30);
  }
  return map;
}

function nameLookup(
  included: PlanIncludedService[] | undefined,
  entitlements: PlanEntitlement[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of included ?? []) {
    const key = entry.serviceKey ?? entry.name;
    if (!map.has(key)) map.set(key, entry.name);
  }
  for (const entitlement of entitlements) {
    if (!map.has(entitlement.serviceId)) map.set(entitlement.serviceId, entitlement.serviceId);
  }
  return map;
}

export function computeVisitProgress(visits: PackageVisitRecord[]): PackageVisitProgress {
  const byServiceMap = new Map<string, { total: number; remaining: number; completed: number }>();
  let remainingVisits = 0;
  let completedVisits = 0;
  let cancelledVisits = 0;
  let missedVisits = 0;
  let scheduledVisits = 0;
  let unscheduledVisits = 0;
  let inProgressVisits = 0;

  for (const visit of visits) {
    const bucket = byServiceMap.get(visit.serviceId) ?? { total: 0, remaining: 0, completed: 0 };
    bucket.total += 1;
    if (visit.status === PACKAGE_VISIT_STATUS.COMPLETED) {
      completedVisits += 1;
      bucket.completed += 1;
    } else if (visit.status === PACKAGE_VISIT_STATUS.CANCELLED) {
      cancelledVisits += 1;
    } else if (visit.status === PACKAGE_VISIT_STATUS.MISSED) {
      missedVisits += 1;
      // Missed visits still consume entitlement under default policy.
      if (visit.entitlementConsumed) {
        bucket.completed += 1;
      } else {
        remainingVisits += 1;
        bucket.remaining += 1;
      }
    } else {
      remainingVisits += 1;
      bucket.remaining += 1;
      if (visit.status === PACKAGE_VISIT_STATUS.SCHEDULED) scheduledVisits += 1;
      else if (visit.status === PACKAGE_VISIT_STATUS.UNSCHEDULED) unscheduledVisits += 1;
      else if (visit.status === PACKAGE_VISIT_STATUS.IN_PROGRESS) inProgressVisits += 1;
    }
    byServiceMap.set(visit.serviceId, bucket);
  }

  return {
    totalVisits: visits.length,
    remainingVisits,
    completedVisits,
    cancelledVisits,
    missedVisits,
    scheduledVisits,
    unscheduledVisits,
    inProgressVisits,
    byService: [...byServiceMap.entries()].map(([serviceId, counts]) => ({
      serviceId,
      ...counts,
    })),
    scheduleState: deriveScheduleState(visits),
  };
}

export function deriveScheduleState(visits: PackageVisitRecord[]): PackageScheduleState {
  if (visits.length === 0) return PACKAGE_SCHEDULE_STATE.NONE;
  const schedulable = visits.filter(
    (visit) =>
      visit.status === PACKAGE_VISIT_STATUS.UNSCHEDULED
      || visit.status === PACKAGE_VISIT_STATUS.SCHEDULED
      || visit.status === PACKAGE_VISIT_STATUS.IN_PROGRESS
      || visit.status === PACKAGE_VISIT_STATUS.COMPLETED,
  );
  if (schedulable.length === 0) return PACKAGE_SCHEDULE_STATE.NONE;
  const withSchedule = schedulable.filter((visit) => Boolean(visit.schedule));
  if (withSchedule.length === 0) return PACKAGE_SCHEDULE_STATE.NONE;
  if (withSchedule.length < schedulable.filter((v) => v.status !== PACKAGE_VISIT_STATUS.CANCELLED).length
    && schedulable.some((v) => v.status === PACKAGE_VISIT_STATUS.UNSCHEDULED)) {
    return PACKAGE_SCHEDULE_STATE.PARTIAL;
  }
  if (schedulable.every((v) => v.status !== PACKAGE_VISIT_STATUS.UNSCHEDULED || Boolean(v.schedule))) {
    const stillOpen = schedulable.some((v) => v.status === PACKAGE_VISIT_STATUS.UNSCHEDULED);
    return stillOpen ? PACKAGE_SCHEDULE_STATE.PARTIAL : PACKAGE_SCHEDULE_STATE.COMPLETE;
  }
  return PACKAGE_SCHEDULE_STATE.PARTIAL;
}

export function toVisitResponse(record: PackageVisitRecord): PackageVisitResponse {
  const { customerId: _customerId, version: _version, ...response } = record;
  return response;
}

export function appendScheduleHistory(
  visit: PackageVisitRecord,
  entry: PackageVisitScheduleHistoryEntry,
): PackageVisitScheduleHistoryEntry[] {
  return [...(visit.scheduleHistory ?? []), entry];
}

export function validityEndsAt(activatedAt: string, validityDays: number | undefined): string | undefined {
  if (validityDays === undefined || validityDays < 1) return undefined;
  const start = new Date(activatedAt);
  if (Number.isNaN(start.getTime())) return undefined;
  start.setUTCDate(start.getUTCDate() + validityDays);
  return start.toISOString();
}

export function assertSchedulePayload(schedule: {
  date?: string;
  startTime?: string;
  timezone?: string;
  branchId?: string;
  durationMinutes?: number;
}): asserts schedule is PackageVisitSchedule {
  if (!schedule.date || !/^\d{4}-\d{2}-\d{2}$/.test(schedule.date)) {
    throw new BookingError('INVALID_SCHEDULE', 'date must be YYYY-MM-DD', 400, 'date', false);
  }
  if (!schedule.startTime || !/^\d{2}:\d{2}$/.test(schedule.startTime)) {
    throw new BookingError('INVALID_SCHEDULE', 'startTime must be HH:mm', 400, 'startTime', false);
  }
  if (!schedule.timezone?.trim()) {
    throw new BookingError('INVALID_SCHEDULE', 'timezone is required', 400, 'timezone', false);
  }
  if (!schedule.branchId?.trim()) {
    throw new BookingError('INVALID_SCHEDULE', 'branchId is required', 400, 'branchId', false);
  }
  if (!Number.isInteger(schedule.durationMinutes) || (schedule.durationMinutes ?? 0) < 1) {
    throw new BookingError('INVALID_SCHEDULE', 'durationMinutes must be a positive integer', 400, 'durationMinutes', false);
  }
}
