import { ValidationError } from '@api-hub/utils';

import { SchedulingCrew } from './crew-assignment';
import { describeWindowClock } from './visit-window';
import {
  OPERATIONS_TIMEZONE,
  SUMMARY_VISIT_CAP,
  calendarDateInTimeZone,
  eachDate,
  inclusiveDayCount,
} from './vendor-package-visits';
import {
  PACKAGE_VISIT_STATUS,
  PackageVisitRecord,
  PackageVisitStatus,
} from '../types/package-visit.types';

export const STAFF_WORK_DAY_CAP = 14;
export const STAFF_WORK_VISIT_CAP = SUMMARY_VISIT_CAP;
export const STAFF_WORK_REASON = {
  NO_CREW: 'noCrewAssignment',
} as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE = 'ACTIVE';

export interface StaffWorkQuery {
  fromDate: string;
  toDate: string;
  status?: PackageVisitStatus;
  limit: number;
  offset: number;
}

export interface StaffCrewMemberView {
  staffId: string;
  name?: string;
}

export interface StaffCrewView {
  crewId: string;
  name: string;
  vanLabel: string;
  staff: StaffCrewMemberView[];
}

export interface StaffAssignedVisit {
  visitId: string;
  crewId: string;
  /** Exact-slot date when present; otherwise the commitment start date. */
  scheduledDate: string;
  scheduleStartDate?: string;
  scheduleEndDate?: string;
  communityId?: string;
  visitWindowId?: string;
  visitWindowName?: string;
  windowTimeKnown: boolean;
  allDay?: boolean;
  crossesMidnight?: boolean;
  windowStart?: string;
  windowEnd?: string;
  windowTimezone?: string;
  vehicle: {
    registrationNumber?: string;
    displayName?: string;
    vehicleType?: string;
  };
  serviceId: string;
  serviceName?: string;
  estimatedMinutes?: number;
  status: PackageVisitStatus;
}

export interface StaffWorkMetrics {
  assigned: number;
  completed: number;
  inProgress: number;
  remaining: number;
  missed: number;
  cancelled: number;
  durationKnown: boolean;
  estimatedMinutes?: number;
}

export interface StaffAssignedWork {
  timezone: typeof OPERATIONS_TIMEZONE;
  fromDate: string;
  toDate: string;
  staffId: string;
  crews: StaffCrewView[];
  reason?: typeof STAFF_WORK_REASON.NO_CREW;
  /** Totals cover every matching visit in the range, including visits on later pages. */
  complete: true;
  /** Display order only. Not a wash sequence or optimized route. */
  ordering: 'list';
  metrics: StaffWorkMetrics;
  items: StaffAssignedVisit[];
  nextToken: string | null;
}

export function isActiveStatus(status: string | undefined): boolean {
  return status?.trim().toUpperCase() === ACTIVE;
}

export function eligibleCrews(crews: readonly SchedulingCrew[], vendorId: string, staffId: string): SchedulingCrew[] {
  return crews.filter((crew) => (
    crew.vendorId === vendorId
    && isActiveStatus(crew.status)
    && crew.staff.some((member) => member.staffId === staffId && isActiveStatus(member.status))
  ));
}

export function toStaffCrew(crew: SchedulingCrew): StaffCrewView {
  return {
    crewId: crew.crewId,
    name: crew.name,
    vanLabel: crew.vanLabel,
    staff: crew.staff.filter((member) => isActiveStatus(member.status)).map((member) => ({
      staffId: member.staffId,
      ...(member.name?.trim() ? { name: member.name.trim() } : {}),
    })),
  };
}

function requireDate(value: string | undefined, field: string): string {
  const date = value?.trim() ?? '';
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new ValidationError(`${field} must be YYYY-MM-DD`);
  }
  return date;
}

export function parseStaffWorkQuery(
  query: Record<string, string | undefined> | null | undefined,
  now: Date,
): StaffWorkQuery {
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
  if (inclusiveDayCount(fromDate, toDate) > STAFF_WORK_DAY_CAP) {
    throw new ValidationError(`Date range cannot exceed ${STAFF_WORK_DAY_CAP} days`);
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
  const limitRaw = source.limit?.trim();
  const limit = limitRaw ? Number(limitRaw) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ValidationError('limit must be an integer from 1 to 50');
  }
  const offset = decodeStaffToken(source.nextToken);
  return {
    fromDate,
    toDate,
    ...(status ? { status } : {}),
    limit,
    offset,
  };
}

export function encodeStaffToken(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

export function decodeStaffToken(token: string | undefined): number {
  if (!token?.trim()) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as { offset?: unknown };
    if (!parsed || typeof parsed.offset !== 'number' || !Number.isInteger(parsed.offset) || parsed.offset < 0) {
      throw new Error('invalid');
    }
    return parsed.offset;
  } catch {
    throw new ValidationError('nextToken is invalid');
  }
}

export function staffDates(query: Pick<StaffWorkQuery, 'fromDate' | 'toDate'>): string[] {
  return eachDate(query.fromDate, query.toDate);
}

function knownDuration(minutes: number | undefined): minutes is number {
  return typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 1;
}

export function compareAssignedVisits(left: PackageVisitRecord, right: PackageVisitRecord): number {
  const leftDate = left.schedule?.date ?? '';
  const rightDate = right.schedule?.date ?? '';
  return leftDate.localeCompare(rightDate)
    || (left.communityId ?? '').localeCompare(right.communityId ?? '')
    || (left.visitWindowId ?? '').localeCompare(right.visitWindowId ?? '')
    || (left.crewAssignment?.crewId ?? '').localeCompare(right.crewAssignment?.crewId ?? '')
    || (left.registrationNumber ?? '').localeCompare(right.registrationNumber ?? '')
    || left.visitId.localeCompare(right.visitId);
}

export function assignedToCrews(
  visits: readonly PackageVisitRecord[],
  vendorId: string,
  crewIds: ReadonlySet<string>,
): PackageVisitRecord[] {
  return visits.filter((visit) => (
    visit.vendorId === vendorId
    && Boolean(visit.schedule?.date)
    && visit.status !== PACKAGE_VISIT_STATUS.UNSCHEDULED
    && Boolean(visit.crewAssignment?.crewId)
    && crewIds.has(visit.crewAssignment!.crewId)
  ));
}

export function staffWorkMetrics(visits: readonly PackageVisitRecord[]): StaffWorkMetrics {
  let completed = 0;
  let inProgress = 0;
  let remaining = 0;
  let missed = 0;
  let cancelled = 0;
  const durations: Array<number | undefined> = [];
  for (const visit of visits) {
    if (visit.status === PACKAGE_VISIT_STATUS.COMPLETED) completed += 1;
    else if (visit.status === PACKAGE_VISIT_STATUS.IN_PROGRESS) inProgress += 1;
    else if (visit.status === PACKAGE_VISIT_STATUS.SCHEDULED) remaining += 1;
    else if (visit.status === PACKAGE_VISIT_STATUS.MISSED) missed += 1;
    else if (visit.status === PACKAGE_VISIT_STATUS.CANCELLED) cancelled += 1;
    if (visit.status !== PACKAGE_VISIT_STATUS.CANCELLED) durations.push(visit.durationMinutes);
  }
  const assigned = completed + inProgress + remaining + missed;
  const durationKnown = durations.every((minutes) => knownDuration(minutes));
  const estimatedMinutes = durationKnown && assigned > 0
    ? durations.reduce<number>((sum, minutes) => sum + (minutes ?? 0), 0)
    : undefined;
  return {
    assigned,
    completed,
    inProgress,
    remaining,
    missed,
    cancelled,
    durationKnown: assigned === 0 || durationKnown,
    ...(estimatedMinutes !== undefined ? { estimatedMinutes } : {}),
  };
}

export function toStaffAssignedVisit(visit: PackageVisitRecord): StaffAssignedVisit | undefined {
  const crewId = visit.crewAssignment?.crewId;
  const scheduledDate = visit.schedule?.date ?? visit.scheduleStartDate;
  if (!crewId || !scheduledDate) return undefined;
  const clock = describeWindowClock(visit.visitWindowSnapshot);
  const serviceName = visit.serviceName?.trim();
  return {
    visitId: visit.visitId,
    crewId,
    scheduledDate,
    ...(visit.scheduleStartDate ? { scheduleStartDate: visit.scheduleStartDate } : {}),
    ...(visit.scheduleEndDate ? { scheduleEndDate: visit.scheduleEndDate } : {}),
    ...(visit.communityId ? { communityId: visit.communityId } : {}),
    ...(visit.visitWindowId ? { visitWindowId: visit.visitWindowId } : {}),
    ...(visit.visitWindowName ? { visitWindowName: visit.visitWindowName } : {}),
    windowTimeKnown: clock.windowTimeKnown,
    ...(clock.allDay ? { allDay: true } : {}),
    ...(clock.crossesMidnight ? { crossesMidnight: true } : {}),
    ...(clock.windowStart ? { windowStart: clock.windowStart } : {}),
    ...(clock.windowEnd ? { windowEnd: clock.windowEnd } : {}),
    ...(clock.windowTimezone ? { windowTimezone: clock.windowTimezone } : {}),
    vehicle: {
      ...(visit.registrationNumber ? { registrationNumber: visit.registrationNumber } : {}),
      ...(visit.vehicleDisplayName ? { displayName: visit.vehicleDisplayName } : {}),
      ...(visit.vehicleType ? { vehicleType: visit.vehicleType } : {}),
    },
    serviceId: visit.serviceId,
    ...(serviceName ? { serviceName } : {}),
    ...(knownDuration(visit.durationMinutes) ? { estimatedMinutes: visit.durationMinutes } : {}),
    status: visit.status,
  };
}

export function pageStaffWork(input: {
  staffId: string;
  crews: readonly SchedulingCrew[];
  visits: readonly PackageVisitRecord[];
  query: StaffWorkQuery;
  reason?: typeof STAFF_WORK_REASON.NO_CREW;
}): StaffAssignedWork {
  const filtered = input.query.status
    ? input?.visits?.filter((visit) => visit.status === input.query.status)
    : [...input?.visits];
  const ordered = [...filtered].sort(compareAssignedVisits);
  const metrics = staffWorkMetrics(ordered);
  const page = ordered.slice(input.query.offset, input.query.offset + input.query.limit);
  const nextOffset = input.query.offset + input.query.limit;
  return {
    timezone: OPERATIONS_TIMEZONE,
    fromDate: input.query.fromDate,
    toDate: input.query.toDate,
    staffId: input.staffId,
    crews: input.crews.map(toStaffCrew),
    ...(input.reason ? { reason: input.reason } : {}),
    complete: true,
    ordering: 'list',
    metrics,
    items: page.flatMap((visit) => {
      const item = toStaffAssignedVisit(visit);
      return item ? [item] : [];
    }),
    nextToken: nextOffset < ordered.length ? encodeStaffToken(nextOffset) : null,
  };
}

export function emptyStaffWork(staffId: string, query: StaffWorkQuery): StaffAssignedWork {
  return pageStaffWork({
    staffId,
    crews: [],
    visits: [],
    query,
    reason: STAFF_WORK_REASON.NO_CREW,
  });
}
