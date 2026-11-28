import { EntityIdGenerator } from '@api-hub/utils';

import { visitSlotUnits } from './ops-supply-demand';
import { authoritativeWindowClock, mergeWindowSnapshot } from './visit-window';
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
    PACKAGE_VISIT_STATUS.BLOCKED,
    PACKAGE_VISIT_STATUS.SCHEDULED, // reschedule keeps SCHEDULED
  ],
  IN_PROGRESS: [PACKAGE_VISIT_STATUS.COMPLETED, PACKAGE_VISIT_STATUS.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
  MISSED: [],
  BLOCKED: [PACKAGE_VISIT_STATUS.SCHEDULED, PACKAGE_VISIT_STATUS.CANCELLED],
};

// export function assertVisitTransition(
//   from: PackageVisitStatus,
//   to: PackageVisitStatus,
// ): void {
//   if (from === to && to === PACKAGE_VISIT_STATUS.SCHEDULED) return;
//   if (!ALLOWED_TRANSITIONS[from].includes(to)) {
//     throw new BookingError(
//       'INVALID_VISIT_TRANSITION',
//       `Cannot transition visit from ${from} to ${to}`,
//       409,
//       'status',
//       false,
//     );
//   }
// }

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
  | 'visitWindowSnapshot'
  | 'vehicleId'
  | 'vehicleType'
  | 'registrationNumber'
  | 'vehicleDisplayName'
  | 'parkingBay'
> {
  const visitWindowSnapshot = authoritativeWindowClock(plan.visitWindowId, plan.visitWindow);
  const parkingBay = plan.location?.parkingBay?.trim();
  return {
    ...(plan.location.communityId ? { communityId: plan.location.communityId } : {}),
    ...(plan.visitWindowId ? { visitWindowId: plan.visitWindowId } : {}),
    ...(plan.visitWindow?.label ? { visitWindowName: plan.visitWindow.label } : {}),
    ...(visitWindowSnapshot ? { visitWindowSnapshot } : {}),
    ...(plan.vehicleId ? { vehicleId: plan.vehicleId } : {}),
    ...(plan.vehicleType ? { vehicleType: plan.vehicleType } : {}),
    ...(plan.vehicleRegistrationNumber
      ? { registrationNumber: plan.vehicleRegistrationNumber.trim().toUpperCase() }
      : {}),
    ...(plan.vehicleDisplayName ? { vehicleDisplayName: plan.vehicleDisplayName } : {}),
    ...(parkingBay ? { parkingBay } : {}),
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
    visitWindowSnapshot: mergeWindowSnapshot(visit.visitWindowSnapshot, snapshot.visitWindowSnapshot),
    vehicleId: visit.vehicleId ?? snapshot.vehicleId,
    vehicleType: visit.vehicleType ?? snapshot.vehicleType,
    registrationNumber: visit.registrationNumber ?? snapshot.registrationNumber,
    vehicleDisplayName: visit.vehicleDisplayName ?? snapshot.vehicleDisplayName,
    parkingBay: visit.parkingBay ?? snapshot.parkingBay,
  };
}

/**
 * Plan **period** demand in workload slot-units (same unit length as vendor
 * commitment daily quantity). Used at payment for period eligibility
 * (`demand` vs `quantity * serviceDays`), not as a single-day debit.
 *
 * Formula (see capacity-commitment CAPACITY_SLOT_MINUTES / visitSlotUnits):
 *   sum over entitlements of
 *     quantity * max(1, ceil(durationMinutes / 30))
 *
 * Duration comes from includedServices keyed by serviceId; missing durations
 * default to one 30-minute slot so legacy plans still consume 1 unit per visit.
 * Per-occurrence daily debits use `visitSlotUnits(visit.durationMinutes)` at schedule.
 */
export function planVisitSlotDemand(
  plan: Pick<CustomerPlanRecord, 'entitlements' | 'includedServices'>,
): number {
  const durationByService = durationLookup(plan.includedServices, plan.entitlements);
  return plan.entitlements.reduce((sum, entitlement) => {
    const minutes = durationByService.get(entitlement.serviceId);
    return sum + entitlement.quantity * visitSlotUnits(minutes);
  }, 0);
}

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
        visitId: EntityIdGenerator.ServiceVisitId(),
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
  let blockedVisits = 0;

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
      else if (visit.status === PACKAGE_VISIT_STATUS.BLOCKED) blockedVisits += 1;
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
    blockedVisits,
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
      || visit.status === PACKAGE_VISIT_STATUS.COMPLETED
      || visit.status === PACKAGE_VISIT_STATUS.BLOCKED,
  );
  if (schedulable.length === 0) return PACKAGE_SCHEDULE_STATE.NONE;
  const withSchedule = schedulable.filter((visit) => visitHasDatedCommitment(visit));
  if (withSchedule.length === 0) return PACKAGE_SCHEDULE_STATE.NONE;
  if (withSchedule.length < schedulable.filter((v) => v.status !== PACKAGE_VISIT_STATUS.CANCELLED).length
    && schedulable.some((v) => v.status === PACKAGE_VISIT_STATUS.UNSCHEDULED)) {
    return PACKAGE_SCHEDULE_STATE.PARTIAL;
  }
  if (schedulable.every((v) => v.status !== PACKAGE_VISIT_STATUS.UNSCHEDULED || visitHasDatedCommitment(v))) {
    const stillOpen = schedulable.some((v) => v.status === PACKAGE_VISIT_STATUS.UNSCHEDULED);
    return stillOpen ? PACKAGE_SCHEDULE_STATE.PARTIAL : PACKAGE_SCHEDULE_STATE.COMPLETE;
  }
  return PACKAGE_SCHEDULE_STATE.PARTIAL;
}

export function toVisitResponse(record: PackageVisitRecord): PackageVisitResponse {
  const {
    customerId: _customerId,
    version: _version,
    crewAssignment: _crewAssignment,
    reviewNote: _reviewNote,
    agreedVendorRateMinor: _agreedVendorRateMinor,
    ...response
  } = record;
  return response;
}

/** Drops a crew assignment without changing visit status or the availability reservation. */
export function withoutCrewAssignment(visit: PackageVisitRecord): PackageVisitRecord {
  if (!visit.crewAssignment) return visit;
  const next = { ...visit };
  delete next.crewAssignment;
  return next;
}

export function appendScheduleHistory(
  visit: PackageVisitRecord,
  entry: PackageVisitScheduleHistoryEntry,
): PackageVisitScheduleHistoryEntry[] {
  return [...(visit.scheduleHistory ?? []), entry];
}

/** Exact slot date, or inclusive range commitment covering the civil day. */
export function visitCoversDate(visit: PackageVisitRecord, date: string): boolean {
  if (visit.status === PACKAGE_VISIT_STATUS.UNSCHEDULED) return false;
  if (visit.scheduleStartDate && visit.scheduleEndDate) {
    return visit.scheduleStartDate <= date && date <= visit.scheduleEndDate;
  }
  return visit.schedule?.date === date;
}

/** True when the visit has any dated commitment (exact or range). */
export function visitHasDatedCommitment(visit: PackageVisitRecord): boolean {
  if (visit.scheduleStartDate && visit.scheduleEndDate) return true;
  return Boolean(visit.schedule?.date);
}

/** Civil date used for GSI1/GSI3 primary keys (range → start; exact → schedule.date). */
export function visitIndexDate(visit: PackageVisitRecord): string | undefined {
  if (visit.scheduleStartDate) return visit.scheduleStartDate;
  return visit.schedule?.date;
}

/**
 * Booking service start date for a package plan: the earliest confirmed visit's
 * local civil service date (exact `schedule.date` or range `scheduleStartDate`).
 * Uses the slot's stored civil date as-is — never derived from confirmation time,
 * cadence, or UTC conversion of a wall-clock instant.
 * Returns undefined when no confirmed dated commitment exists.
 */
export function earliestConfirmedServiceDate(
  visits: readonly PackageVisitRecord[],
): string | undefined {
  let earliest: string | undefined;
  for (const visit of visits) {
    if (
      visit.status === PACKAGE_VISIT_STATUS.UNSCHEDULED
      || visit.status === PACKAGE_VISIT_STATUS.CANCELLED
    ) {
      continue;
    }
    if (!visitHasDatedCommitment(visit)) continue;
    const date = visitIndexDate(visit)?.trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!earliest || date < earliest) earliest = date;
  }
  return earliest;
}

export function commitmentSnapshot(visit: PackageVisitRecord): PackageVisitScheduleHistoryEntry['from'] {
  return {
    ...(visit.schedule ?? {}),
    ...(visit.scheduleStartDate ? { scheduleStartDate: visit.scheduleStartDate } : {}),
    ...(visit.scheduleEndDate ? { scheduleEndDate: visit.scheduleEndDate } : {}),
    ...(visit.visitWindowId ? { visitWindowId: visit.visitWindowId } : {}),
    ...(visit.scheduleId ? { scheduleId: visit.scheduleId } : {}),
    ...(visit.crewAssignment?.crewId ? { crewId: visit.crewAssignment.crewId } : {}),
  };
}

export function clearVisitCommitment(visit: PackageVisitRecord): PackageVisitRecord {
  const next = withoutCrewAssignment({ ...visit });
  delete next.schedule;
  delete next.scheduleId;
  delete next.scheduleStartDate;
  delete next.scheduleEndDate;
  return next;
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
