import { ValidationError } from '@api-hub/utils';

import {
  PACKAGE_VISIT_STATUS,
  PackageVisitRecord,
  PackageVisitStatus,
} from '../types/package-visit.types';

/** Kochi MVP operational calendar. Device timezone is not used. */
export const OPERATIONS_TIMEZONE = 'Asia/Kolkata';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIST_DAYS = 31;
const MAX_SUMMARY_DAYS = 14;
export const SUMMARY_VISIT_CAP = 1500;

/**
 * Dated demand and today's board.
 * CANCELLED is reported separately and is not waiting.
 * UNSCHEDULED entitlements are not scheduled demand.
 * MISSED is the supported unused-window status. There is no SKIPPED status.
 */
export const VISIT_METRIC_STATUS = {
  expected: [
    PACKAGE_VISIT_STATUS.SCHEDULED,
    PACKAGE_VISIT_STATUS.IN_PROGRESS,
    PACKAGE_VISIT_STATUS.COMPLETED,
    PACKAGE_VISIT_STATUS.MISSED,
  ],
  completed: [PACKAGE_VISIT_STATUS.COMPLETED],
  inProgress: [PACKAGE_VISIT_STATUS.IN_PROGRESS],
  waiting: [PACKAGE_VISIT_STATUS.SCHEDULED],
  missed: [PACKAGE_VISIT_STATUS.MISSED],
  cancelled: [PACKAGE_VISIT_STATUS.CANCELLED],
} as const;

export interface VendorVisitQuery {
  fromDate: string;
  toDate: string;
  communityId?: string;
  visitWindowId?: string;
  status?: PackageVisitStatus;
  search?: string;
  limit: number;
}

export interface VendorVisitMetrics {
  expected: number;
  completed: number;
  inProgress: number;
  waiting: number;
  missed: number;
  cancelled: number;
  completionPercent: number;
}

export interface VendorVisitAttentionGroup {
  communityId: string;
  visitWindowId: string;
  visitWindowName?: string;
  waiting: number;
}

export interface VendorVisitCommunitySummary {
  communityId: string;
  scheduled: number;
  completed: number;
  inProgress: number;
  waiting: number;
  completionPercent: number;
}

export interface VendorVisitDemandGroup {
  date: string;
  communityId: string;
  visitWindowId: string;
  visitWindowName?: string;
  scheduled: number;
  waiting: number;
  inProgress: number;
  completed: number;
  missed: number;
}

export interface VendorVisitSummary {
  timezone: typeof OPERATIONS_TIMEZONE;
  today: string;
  fromDate: string;
  toDate: string;
  complete: true;
  metrics: VendorVisitMetrics;
  needsAttention: VendorVisitAttentionGroup[];
  communities: VendorVisitCommunitySummary[];
  demand: {
    totalScheduled: number;
    groupCount: number;
    days: Array<{ date: string; count: number }>;
    nextGroup: VendorVisitDemandGroup | null;
    groups: VendorVisitDemandGroup[];
  };
}

export interface VendorPackageVisitItem {
  visitId: string;
  planId: string;
  vendorId: string;
  communityId?: string;
  visitWindowId?: string;
  visitWindowName?: string;
  scheduledDate?: string;
  startTime?: string;
  status: PackageVisitStatus;
  vehicle: {
    vehicleId?: string;
    registrationNumber?: string;
    displayName?: string;
    vehicleType?: string;
  };
  service: {
    serviceId: string;
    name: string;
    estimatedMinutes: number;
  };
}

export function calendarDateInTimeZone(now: Date, timeZone = OPERATIONS_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new ValidationError('Operational date could not be resolved');
  }
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function inclusiveDayCount(fromDate: string, toDate: string): number {
  const start = Date.parse(`${fromDate}T00:00:00Z`);
  const end = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

export function eachDate(fromDate: string, toDate: string): string[] {
  const count = inclusiveDayCount(fromDate, toDate);
  return Array.from({ length: count }, (_, index) => addCalendarDays(fromDate, index));
}

function requireDate(value: string | undefined, field: string): string {
  const date = value?.trim() ?? '';
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new ValidationError(`${field} must be YYYY-MM-DD`);
  }
  return date;
}

function optionalId(value: string | undefined, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const id = value.trim();
  if (!id || id.length > 80) throw new ValidationError(`${field} is invalid`);
  return id;
}

export function parseVendorVisitQuery(
  query: Record<string, string | undefined> | null | undefined,
  now: Date,
): VendorVisitQuery {
  const source = query ?? {};
  const date = source.date?.trim();
  const from = source.fromDate?.trim();
  const to = source.toDate?.trim();
  if (date && (from || to)) {
    throw new ValidationError('date cannot be combined with fromDate or toDate');
  }
  let fromDate: string;
  let toDate: string;
  if (date) {
    fromDate = requireDate(date, 'date');
    toDate = fromDate;
  } else if (from || to) {
    fromDate = requireDate(from, 'fromDate');
    toDate = requireDate(to, 'toDate');
  } else {
    fromDate = calendarDateInTimeZone(now);
    toDate = fromDate;
  }
  if (fromDate > toDate) throw new ValidationError('fromDate must be on or before toDate');
  if (inclusiveDayCount(fromDate, toDate) > MAX_LIST_DAYS) {
    throw new ValidationError(`Date range cannot exceed ${MAX_LIST_DAYS} days`);
  }
  const statusRaw = source.status?.trim();
  let status: PackageVisitStatus | undefined;
  if (statusRaw) {
    const allowed = Object.values(PACKAGE_VISIT_STATUS);
    if (!allowed.includes(statusRaw as PackageVisitStatus)) {
      throw new ValidationError('status is not a package visit status');
    }
    status = statusRaw as PackageVisitStatus;
  }
  const searchRaw = source.search?.trim();
  if (searchRaw && searchRaw.length > 20) throw new ValidationError('search must be at most 20 characters');
  const limitRaw = source.limit?.trim();
  const limit = limitRaw ? Number(limitRaw) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ValidationError('limit must be an integer from 1 to 50');
  }
  return {
    fromDate,
    toDate,
    ...(optionalId(source.communityId, 'communityId')
      ? { communityId: optionalId(source.communityId, 'communityId') }
      : {}),
    ...(optionalId(source.visitWindowId, 'visitWindowId')
      ? { visitWindowId: optionalId(source.visitWindowId, 'visitWindowId') }
      : {}),
    ...(status ? { status } : {}),
    ...(searchRaw ? { search: searchRaw.toUpperCase() } : {}),
    limit,
  };
}

export function parseSummaryRange(
  query: Record<string, string | undefined> | null | undefined,
  now: Date,
): { fromDate: string; toDate: string; today: string } {
  const source = query ?? {};
  const today = calendarDateInTimeZone(now);
  const fromDate = source.fromDate?.trim()
    ? requireDate(source.fromDate, 'fromDate')
    : today;
  const toDate = source.toDate?.trim()
    ? requireDate(source.toDate, 'toDate')
    : addCalendarDays(fromDate, 6);
  if (fromDate > toDate) throw new ValidationError('fromDate must be on or before toDate');
  if (inclusiveDayCount(fromDate, toDate) > MAX_SUMMARY_DAYS) {
    throw new ValidationError(`Summary range cannot exceed ${MAX_SUMMARY_DAYS} days`);
  }
  return { fromDate, toDate, today };
}

export function visitMatchesFilters(
  visit: PackageVisitRecord,
  filters: Pick<VendorVisitQuery, 'communityId' | 'visitWindowId' | 'status' | 'search'>,
): boolean {
  if (!visit.schedule?.date || visit.status === PACKAGE_VISIT_STATUS.UNSCHEDULED) return false;
  if (filters.status && visit.status !== filters.status) return false;
  if (filters.communityId && visit.communityId !== filters.communityId) return false;
  if (filters.visitWindowId && visit.visitWindowId !== filters.visitWindowId) return false;
  if (filters.search) {
    const registration = (visit.registrationNumber ?? '').toUpperCase();
    if (!registration.includes(filters.search.toUpperCase())) return false;
  }
  return true;
}

export function toVendorPackageVisit(visit: PackageVisitRecord): VendorPackageVisitItem {
  return {
    visitId: visit.visitId,
    planId: visit.planId,
    vendorId: visit.vendorId,
    ...(visit.communityId ? { communityId: visit.communityId } : {}),
    ...(visit.visitWindowId ? { visitWindowId: visit.visitWindowId } : {}),
    ...(visit.visitWindowName ? { visitWindowName: visit.visitWindowName } : {}),
    ...(visit.schedule?.date ? { scheduledDate: visit.schedule.date } : {}),
    ...(visit.schedule?.startTime ? { startTime: visit.schedule.startTime } : {}),
    status: visit.status,
    vehicle: {
      ...(visit.vehicleId ? { vehicleId: visit.vehicleId } : {}),
      ...(visit.registrationNumber ? { registrationNumber: visit.registrationNumber } : {}),
      ...(visit.vehicleDisplayName ? { displayName: visit.vehicleDisplayName } : {}),
      ...(visit.vehicleType ? { vehicleType: visit.vehicleType } : {}),
    },
    service: {
      serviceId: visit.serviceId,
      name: visit.serviceName,
      estimatedMinutes: visit.durationMinutes,
    },
  };
}

function countsAs(status: PackageVisitStatus, group: readonly PackageVisitStatus[]): boolean {
  return group.includes(status);
}

function completionPercent(completed: number, expected: number): number {
  if (expected <= 0) return 0;
  return Math.round((completed / expected) * 100);
}

function datedVisits(visits: readonly PackageVisitRecord[], fromDate: string, toDate: string): PackageVisitRecord[] {
  return visits.filter((visit) => {
    const date = visit.schedule?.date;
    return Boolean(date) && date! >= fromDate && date! <= toDate && visit.status !== PACKAGE_VISIT_STATUS.UNSCHEDULED;
  });
}

export function summarizeVendorVisits(input: {
  visits: readonly PackageVisitRecord[];
  today: string;
  fromDate: string;
  toDate: string;
}): VendorVisitSummary {
  const inRange = datedVisits(input.visits, input.fromDate, input.toDate);
  const todayVisits = inRange.filter((visit) => visit.schedule?.date === input.today);
  const metrics = metricsFor(todayVisits);
  const groups = demandGroups(inRange);
  const demandVisits = inRange.filter((visit) => countsAs(visit.status, VISIT_METRIC_STATUS.expected));
  const days = eachDate(input.fromDate, input.toDate).map((date) => ({
    date,
    count: demandVisits.filter((visit) => visit.schedule?.date === date).length,
  }));
  const upcoming = groups.filter((group) =>
    group.date >= input.today && (group.waiting > 0 || group.inProgress > 0));
  const nextGroup = [...upcoming].sort((left, right) =>
    left.date.localeCompare(right.date)
    || right.waiting - left.waiting
    || right.scheduled - left.scheduled
    || left.communityId.localeCompare(right.communityId))[0] ?? null;

  return {
    timezone: OPERATIONS_TIMEZONE,
    today: input.today,
    fromDate: input.fromDate,
    toDate: input.toDate,
    complete: true,
    metrics,
    needsAttention: attentionGroups(todayVisits),
    communities: communitySummaries(todayVisits),
    demand: {
      totalScheduled: demandVisits.length,
      groupCount: groups.filter((group) => group.scheduled > 0).length,
      days,
      nextGroup,
      groups,
    },
  };
}

function metricsFor(visits: readonly PackageVisitRecord[]): VendorVisitMetrics {
  const expected = visits.filter((visit) => countsAs(visit.status, VISIT_METRIC_STATUS.expected));
  const completed = expected.filter((visit) => countsAs(visit.status, VISIT_METRIC_STATUS.completed)).length;
  const inProgress = expected.filter((visit) => countsAs(visit.status, VISIT_METRIC_STATUS.inProgress)).length;
  const waiting = expected.filter((visit) => countsAs(visit.status, VISIT_METRIC_STATUS.waiting)).length;
  const missed = expected.filter((visit) => countsAs(visit.status, VISIT_METRIC_STATUS.missed)).length;
  const cancelled = visits.filter((visit) => countsAs(visit.status, VISIT_METRIC_STATUS.cancelled)).length;
  return {
    expected: expected.length,
    completed,
    inProgress,
    waiting,
    missed,
    cancelled,
    completionPercent: completionPercent(completed, expected.length),
  };
}

function attentionGroups(visits: readonly PackageVisitRecord[]): VendorVisitAttentionGroup[] {
  const groups = new Map<string, VendorVisitAttentionGroup>();
  for (const visit of visits) {
    if (!countsAs(visit.status, VISIT_METRIC_STATUS.waiting)) continue;
    const communityId = visit.communityId ?? '';
    const visitWindowId = visit.visitWindowId ?? '';
    const key = `${communityId}\u0000${visitWindowId}`;
    const current = groups.get(key) ?? {
      communityId,
      visitWindowId,
      ...(visit.visitWindowName ? { visitWindowName: visit.visitWindowName } : {}),
      waiting: 0,
    };
    current.waiting += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((left, right) =>
    right.waiting - left.waiting
    || left.communityId.localeCompare(right.communityId)
    || left.visitWindowId.localeCompare(right.visitWindowId));
}

function communitySummaries(visits: readonly PackageVisitRecord[]): VendorVisitCommunitySummary[] {
  const groups = new Map<string, PackageVisitRecord[]>();
  for (const visit of visits) {
    if (!countsAs(visit.status, VISIT_METRIC_STATUS.expected)) continue;
    const communityId = visit.communityId ?? '';
    groups.set(communityId, [...(groups.get(communityId) ?? []), visit]);
  }
  return [...groups.entries()]
    .map(([communityId, rows]) => {
      const metrics = metricsFor(rows);
      return {
        communityId,
        scheduled: metrics.expected,
        completed: metrics.completed,
        inProgress: metrics.inProgress,
        waiting: metrics.waiting,
        completionPercent: metrics.completionPercent,
      };
    })
    .sort((left, right) => right.scheduled - left.scheduled || left.communityId.localeCompare(right.communityId));
}

function demandGroups(visits: readonly PackageVisitRecord[]): VendorVisitDemandGroup[] {
  const groups = new Map<string, VendorVisitDemandGroup>();
  for (const visit of visits) {
    if (!countsAs(visit.status, VISIT_METRIC_STATUS.expected) || !visit.schedule?.date) continue;
    const communityId = visit.communityId ?? '';
    const visitWindowId = visit.visitWindowId ?? '';
    const key = `${visit.schedule.date}\u0000${communityId}\u0000${visitWindowId}`;
    const current = groups.get(key) ?? {
      date: visit.schedule.date,
      communityId,
      visitWindowId,
      ...(visit.visitWindowName ? { visitWindowName: visit.visitWindowName } : {}),
      scheduled: 0,
      waiting: 0,
      inProgress: 0,
      completed: 0,
      missed: 0,
    };
    current.scheduled += 1;
    if (countsAs(visit.status, VISIT_METRIC_STATUS.waiting)) current.waiting += 1;
    if (countsAs(visit.status, VISIT_METRIC_STATUS.inProgress)) current.inProgress += 1;
    if (countsAs(visit.status, VISIT_METRIC_STATUS.completed)) current.completed += 1;
    if (countsAs(visit.status, VISIT_METRIC_STATUS.missed)) current.missed += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((left, right) =>
    left.date.localeCompare(right.date)
    || left.communityId.localeCompare(right.communityId)
    || left.visitWindowId.localeCompare(right.visitWindowId));
}

export function encodeVisitToken(key: Record<string, unknown> | undefined): string | null {
  if (!key) return null;
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

export function decodeVisitToken(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ValidationError('nextToken is invalid');
  }
}
