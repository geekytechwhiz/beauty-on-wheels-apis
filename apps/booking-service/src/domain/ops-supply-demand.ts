import { ValidationError } from '@api-hub/utils';

import { PACKAGE_VISIT_STATUS, PackageVisitRecord, PackageVisitStatus } from '../types/package-visit.types';
import { eachDate, inclusiveDayCount } from './vendor-package-visits';

/** Same slot length Vendor Service uses for commitment quantity. */
export const DEMAND_SLOT_MINUTES = 30;
export const MAX_DEMAND_DAYS = 31;
export const MAX_DEMAND_VISITS = 5000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const DEMAND_STATUSES: readonly PackageVisitStatus[] = [
  PACKAGE_VISIT_STATUS.SCHEDULED,
  PACKAGE_VISIT_STATUS.IN_PROGRESS,
  PACKAGE_VISIT_STATUS.COMPLETED,
  PACKAGE_VISIT_STATUS.MISSED,
];

export interface DemandBucket {
  demandVisits: number;
  demandSlotUnits: number;
  scheduled: number;
  inProgress: number;
  completed: number;
  missed: number;
  cancelled: number;
}

export interface DemandWindowBucket extends DemandBucket {
  visitWindowId: string;
  visitWindowName?: string;
}

export function requireIsoDate(value: string | undefined, field: string): string {
  const date = value?.trim() ?? '';
  if (!DATE.test(date)) throw new ValidationError(`${field} must be YYYY-MM-DD`);
  return date;
}

export function demandDates(fromDate: string, toDate: string): string[] {
  if (fromDate > toDate) throw new ValidationError('fromDate must be on or before toDate');
  if (inclusiveDayCount(fromDate, toDate) > MAX_DEMAND_DAYS) {
    throw new ValidationError(`Demand range cannot exceed ${MAX_DEMAND_DAYS} days`);
  }
  return eachDate(fromDate, toDate);
}

/** Visit-slot units. One visit is at least one unit; longer work rounds up by 30 minutes. */
export function visitSlotUnits(durationMinutes: number | undefined): number {
  const minutes = Number.isFinite(durationMinutes) && (durationMinutes as number) > 0
    ? (durationMinutes as number)
    : DEMAND_SLOT_MINUTES;
  return Math.max(1, Math.ceil(minutes / DEMAND_SLOT_MINUTES));
}

export function emptyDemandBucket(): DemandBucket {
  return {
    demandVisits: 0,
    demandSlotUnits: 0,
    scheduled: 0,
    inProgress: 0,
    completed: 0,
    missed: 0,
    cancelled: 0,
  };
}

export function addVisitToDemand(bucket: DemandBucket, visit: PackageVisitRecord): void {
  const units = visitSlotUnits(visit.durationMinutes);
  if (visit.status === PACKAGE_VISIT_STATUS.CANCELLED) {
    bucket.cancelled += 1;
    return;
  }
  if (!DEMAND_STATUSES.includes(visit.status)) return;
  bucket.demandVisits += 1;
  bucket.demandSlotUnits += units;
  if (visit.status === PACKAGE_VISIT_STATUS.SCHEDULED) bucket.scheduled += 1;
  else if (visit.status === PACKAGE_VISIT_STATUS.IN_PROGRESS) bucket.inProgress += 1;
  else if (visit.status === PACKAGE_VISIT_STATUS.COMPLETED) bucket.completed += 1;
  else if (visit.status === PACKAGE_VISIT_STATUS.MISSED) bucket.missed += 1;
}

export function aggregateDemand(visits: readonly PackageVisitRecord[]): {
  totals: DemandBucket;
  byWindow: DemandWindowBucket[];
} {
  const totals = emptyDemandBucket();
  const windows = new Map<string, DemandWindowBucket>();
  for (const visit of visits) {
    addVisitToDemand(totals, visit);
    const visitWindowId = visit.visitWindowId?.trim() || '_';
    const current = windows.get(visitWindowId) ?? {
      ...emptyDemandBucket(),
      visitWindowId,
      ...(visit.visitWindowName ? { visitWindowName: visit.visitWindowName } : {}),
    };
    if (!current.visitWindowName && visit.visitWindowName) current.visitWindowName = visit.visitWindowName;
    addVisitToDemand(current, visit);
    windows.set(visitWindowId, current);
  }
  return {
    totals,
    byWindow: [...windows.values()].sort((left, right) => left.visitWindowId.localeCompare(right.visitWindowId)),
  };
}
