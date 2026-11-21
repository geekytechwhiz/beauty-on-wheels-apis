import { ValidationError } from '@api-hub/utils';
import { z } from 'zod';

import { BookingError } from '../errors';
import { Booking } from '../types/api-types';
import {
  PACKAGE_VISIT_STATUS,
  PackageVisitRecord,
  PackageVisitStatus,
} from '../types/package-visit.types';
import {
  SUMMARY_VISIT_CAP,
  addCalendarDays,
  calendarDateInTimeZone,
  eachDate,
} from './vendor-package-visits';
import { assertIanaTimezone } from './vendor-operations-summary';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_UPCOMING_DAYS = 3;
const MIN_UPCOMING_DAYS = 1;
const MAX_UPCOMING_DAYS = 7;

/**
 * Home-summary counting rules (package visits + one-time bookings):
 *
 * Scope
 *   Dated package visits and standalone bookings for the resolved civil `date`
 *   (and upcoming range). UNSCHEDULED visits are excluded from every total.
 *   CANCELLED is excluded from `total` and crew counts but reported separately
 *   as `cancelled`. Bookings with `planId` are package-linked jobs and are
 *   excluded so the PackageVisit row remains the canonical work item.
 *
 * today.visits
 *   total      = SCHEDULED + IN_PROGRESS + COMPLETED + BLOCKED + MISSED
 *                (+ booking CONFIRMED|CHECKED_IN|IN_PROGRESS|COMPLETED)
 *   completed  = COMPLETED (visit or booking)
 *   inProgress = IN_PROGRESS (visit or booking)
 *   notStarted = SCHEDULED visits, or CONFIRMED|CHECKED_IN bookings
 *   blocked    = BLOCKED (persisted visit status only; never inferred)
 *   missed     = MISSED (visits only; bookings have no MISSED)
 *   cancelled  = CANCELLED (visible; not in total)
 *
 * today.crew
 *   assigned / unassigned count package visits among the same set as `total`.
 *   One-time bookings do not use package crew assignment and are excluded from
 *   crew counts so they do not inflate unassigned.
 *
 * today.completion
 *   completed / total / percentage = round(100 * completed / total), or 0 when
 *   total is 0. Denominator is today.visits.total (excludes CANCELLED).
 *
 * today.needsAttention
 *   Groups by communityId + visitWindowId for package visits that are BLOCKED
 *   and/or SCHEDULED without a crew. One-time bookings have no visitWindow and
 *   are omitted from window-level attention groups.
 *
 * tomorrow / upcoming
 *   Calendar days after `date`. upcomingDays defaults to 3 (1–7). Each day
 *   reports total / assigned / unassigned among non-cancelled dated work.
 *   Crew assigned/unassigned still apply only to package visits; bookings
 *   contribute to totalVisits only. communities lists only communities with
 *   unassignedCount > 0 (package visits).
 */

export const HOME_SUMMARY_VISIT_STATUS = {
  total: [
    PACKAGE_VISIT_STATUS.SCHEDULED,
    PACKAGE_VISIT_STATUS.IN_PROGRESS,
    PACKAGE_VISIT_STATUS.COMPLETED,
    PACKAGE_VISIT_STATUS.BLOCKED,
    PACKAGE_VISIT_STATUS.MISSED,
  ],
  completed: [PACKAGE_VISIT_STATUS.COMPLETED],
  inProgress: [PACKAGE_VISIT_STATUS.IN_PROGRESS],
  notStarted: [PACKAGE_VISIT_STATUS.SCHEDULED],
  blocked: [PACKAGE_VISIT_STATUS.BLOCKED],
  missed: [PACKAGE_VISIT_STATUS.MISSED],
  cancelled: [PACKAGE_VISIT_STATUS.CANCELLED],
} as const;

const HOME_SUMMARY_BOOKING_STATUS = {
  total: ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'] as const,
  completed: ['COMPLETED'] as const,
  inProgress: ['IN_PROGRESS'] as const,
  notStarted: ['CONFIRMED', 'CHECKED_IN'] as const,
  cancelled: ['CANCELLED'] as const,
} as const;

export type HomeWorkKind =
  | 'completed'
  | 'inProgress'
  | 'notStarted'
  | 'blocked'
  | 'missed'
  | 'cancelled';

export interface HomeWorkUnit {
  source: 'packageVisit' | 'oneTimeBooking';
  id: string;
  date: string;
  kind: HomeWorkKind;
  /** Contributes to visits.total when true. Cancelled units are never expected. */
  expected: boolean;
  /** Package-visit crew metrics only. One-time bookings are false. */
  crewApplicable: boolean;
  assigned: boolean;
  communityId: string | null;
  visitWindowId: string | null;
  visitWindowName: string | null;
}

export interface VendorHomeVisitCounts {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  blocked: number;
  missed: number;
  cancelled: number;
}

export interface VendorHomeCrewCounts {
  assigned: number;
  unassigned: number;
}

export interface VendorHomeCompletion {
  completed: number;
  total: number;
  percentage: number;
}

export interface VendorHomeAttentionGroup {
  communityId: string;
  communityName?: string;
  visitWindowId: string;
  visitWindowName?: string;
  visitCount: number;
  blockedCount: number;
  unassignedCount: number;
}

export interface VendorHomeDaySummary {
  date: string;
  totalVisits: number;
  assignedVisits: number;
  unassignedVisits: number;
}

export interface VendorHomeUpcomingCommunity {
  communityId: string;
  communityName?: string;
  visitCount: number;
  unassignedCount: number;
}

export interface VendorHomeUpcomingDay extends VendorHomeDaySummary {
  communities: VendorHomeUpcomingCommunity[];
}

export interface VendorHomeSummary {
  vendorId: string;
  timezone: string;
  date: string;
  today: {
    visits: VendorHomeVisitCounts;
    crew: VendorHomeCrewCounts;
    completion: VendorHomeCompletion;
    needsAttention: VendorHomeAttentionGroup[];
  };
  tomorrow: VendorHomeDaySummary;
  upcoming: {
    fromDate: string;
    toDate: string;
    days: VendorHomeUpcomingDay[];
  };
}

export const VendorHomeSummarySchema = z.object({
  vendorId: z.string().min(1),
  timezone: z.string().min(1),
  date: z.string().regex(DATE_PATTERN),
  today: z.object({
    visits: z.object({
      total: z.number().int().nonnegative(),
      completed: z.number().int().nonnegative(),
      inProgress: z.number().int().nonnegative(),
      notStarted: z.number().int().nonnegative(),
      blocked: z.number().int().nonnegative(),
      missed: z.number().int().nonnegative(),
      cancelled: z.number().int().nonnegative(),
    }),
    crew: z.object({
      assigned: z.number().int().nonnegative(),
      unassigned: z.number().int().nonnegative(),
    }),
    completion: z.object({
      completed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      percentage: z.number().int().nonnegative(),
    }),
    needsAttention: z.array(z.object({
      communityId: z.string().min(1),
      communityName: z.string().min(1).optional(),
      visitWindowId: z.string().min(1),
      visitWindowName: z.string().min(1).optional(),
      visitCount: z.number().int().positive(),
      blockedCount: z.number().int().nonnegative(),
      unassignedCount: z.number().int().nonnegative(),
    })),
  }),
  tomorrow: z.object({
    date: z.string().regex(DATE_PATTERN),
    totalVisits: z.number().int().nonnegative(),
    assignedVisits: z.number().int().nonnegative(),
    unassignedVisits: z.number().int().nonnegative(),
  }),
  upcoming: z.object({
    fromDate: z.string().regex(DATE_PATTERN),
    toDate: z.string().regex(DATE_PATTERN),
    days: z.array(z.object({
      date: z.string().regex(DATE_PATTERN),
      totalVisits: z.number().int().nonnegative(),
      assignedVisits: z.number().int().nonnegative(),
      unassignedVisits: z.number().int().nonnegative(),
      communities: z.array(z.object({
        communityId: z.string().min(1),
        communityName: z.string().min(1).optional(),
        visitCount: z.number().int().positive(),
        unassignedCount: z.number().int().positive(),
      })),
    })),
  }),
});

export function parseHomeSummaryQuery(
  query: Record<string, string | undefined> | null | undefined,
  now: Date,
  timezone: string,
): { date: string; upcomingDays: number; fromDate: string; toDate: string } {
  const source = query ?? {};
  const zone = assertIanaTimezone(timezone);
  const dateRaw = source.date?.trim();
  const date = dateRaw ? requireDate(dateRaw, 'date') : calendarDateInTimeZone(now, zone);
  const upcomingDays = parseUpcomingDays(source.upcomingDays);
  const fromDate = date;
  const toDate = addCalendarDays(date, upcomingDays);
  return { date, upcomingDays, fromDate, toDate };
}

export function packageVisitToHomeUnit(visit: PackageVisitRecord): HomeWorkUnit | null {
  if (!visit.schedule?.date || visit.status === PACKAGE_VISIT_STATUS.UNSCHEDULED) return null;
  const kind = visitKind(visit.status);
  if (!kind) return null;
  return {
    source: 'packageVisit',
    id: visit.visitId,
    date: visit.schedule.date,
    kind,
    expected: countsAs(visit.status, HOME_SUMMARY_VISIT_STATUS.total),
    crewApplicable: true,
    assigned: Boolean(visit.crewAssignment?.crewId?.trim()),
    communityId: visit.communityId?.trim() || null,
    visitWindowId: visit.visitWindowId?.trim() || null,
    visitWindowName: visit.visitWindowName?.trim() || null,
  };
}

/**
 * One-time bookings only. Package-linked bookings (planId set) are skipped so the
 * PackageVisit row remains the single operational representation.
 */
export function oneTimeBookingToHomeUnit(booking: Booking): HomeWorkUnit | null {
  if (booking.planId?.trim()) return null;
  const date = (booking.schedule?.date ?? booking.bookingDate)?.trim();
  if (!date) return null;
  const status = booking.bookingStatus;
  if (!status) return null;
  const kind = bookingKind(status);
  if (!kind) return null;
  return {
    source: 'oneTimeBooking',
    id: booking.id ?? '',
    date,
    kind,
    expected: (HOME_SUMMARY_BOOKING_STATUS.total as readonly string[]).includes(status),
    crewApplicable: false,
    assigned: false,
    communityId: bookingCommunityId(booking),
    visitWindowId: null,
    visitWindowName: null,
  };
}

export function summarizeVendorHome(input: {
  vendorId: string;
  timezone: string;
  date: string;
  upcomingDays: number;
  visits: readonly PackageVisitRecord[];
  bookings?: readonly Booking[];
}): VendorHomeSummary {
  const timezone = assertIanaTimezone(input.timezone);
  const tomorrowDate = addCalendarDays(input.date, 1);
  const upcomingFrom = tomorrowDate;
  const upcomingTo = addCalendarDays(input.date, input.upcomingDays);
  const units = [
    ...input.visits.map(packageVisitToHomeUnit),
    ...(input.bookings ?? []).map(oneTimeBookingToHomeUnit),
  ].filter((unit): unit is HomeWorkUnit => Boolean(unit));

  if (units.length > SUMMARY_VISIT_CAP) {
    throw new BookingError(
      'SUMMARY_TOO_LARGE',
      'Narrow the date range. Totals are not returned for a partial read.',
      409,
      'upcomingDays',
      false,
    );
  }

  const todayUnits = units.filter((unit) => unit.date === input.date);
  const visitCounts = visitCountsFor(todayUnits);
  const crew = crewCountsFor(todayUnits);
  const completion = {
    completed: visitCounts.completed,
    total: visitCounts.total,
    percentage: completionPercent(visitCounts.completed, visitCounts.total),
  };

  const upcomingDates = eachDate(upcomingFrom, upcomingTo);
  const days = upcomingDates.map((day) => daySummary(units.filter((unit) => unit.date === day), day));
  const tomorrow = days.find((day) => day.date === tomorrowDate) ?? emptyDay(tomorrowDate);

  return {
    vendorId: input.vendorId,
    timezone,
    date: input.date,
    today: {
      visits: visitCounts,
      crew,
      completion,
      needsAttention: attentionGroups(todayUnits),
    },
    tomorrow: {
      date: tomorrow.date,
      totalVisits: tomorrow.totalVisits,
      assignedVisits: tomorrow.assignedVisits,
      unassignedVisits: tomorrow.unassignedVisits,
    },
    upcoming: {
      fromDate: upcomingFrom,
      toDate: upcomingTo,
      days,
    },
  };
}

export { SUMMARY_VISIT_CAP, eachDate, addCalendarDays };

function visitCountsFor(units: readonly HomeWorkUnit[]): VendorHomeVisitCounts {
  return {
    total: units.filter((unit) => unit.expected).length,
    completed: units.filter((unit) => unit.kind === 'completed').length,
    inProgress: units.filter((unit) => unit.kind === 'inProgress').length,
    notStarted: units.filter((unit) => unit.kind === 'notStarted').length,
    blocked: units.filter((unit) => unit.kind === 'blocked').length,
    missed: units.filter((unit) => unit.kind === 'missed').length,
    cancelled: units.filter((unit) => unit.kind === 'cancelled').length,
  };
}

function crewCountsFor(units: readonly HomeWorkUnit[]): VendorHomeCrewCounts {
  const scoped = units.filter((unit) => unit.expected && unit.crewApplicable);
  const assigned = scoped.filter((unit) => unit.assigned).length;
  return {
    assigned,
    unassigned: scoped.length - assigned,
  };
}

function daySummary(units: readonly HomeWorkUnit[], date: string): VendorHomeUpcomingDay {
  const expected = units.filter((unit) => unit.expected);
  const crewScoped = expected.filter((unit) => unit.crewApplicable);
  const assigned = crewScoped.filter((unit) => unit.assigned).length;
  const unassigned = crewScoped.length - assigned;
  return {
    date,
    totalVisits: expected.length,
    assignedVisits: assigned,
    unassignedVisits: unassigned,
    communities: communityUnassigned(crewScoped),
  };
}

function emptyDay(date: string): VendorHomeUpcomingDay {
  return {
    date,
    totalVisits: 0,
    assignedVisits: 0,
    unassignedVisits: 0,
    communities: [],
  };
}

function attentionGroups(units: readonly HomeWorkUnit[]): VendorHomeAttentionGroup[] {
  const groups = new Map<string, {
    communityId: string;
    communityName?: string;
    visitWindowId: string;
    visitWindowName?: string;
    visitIds: Set<string>;
    blockedCount: number;
    unassignedCount: number;
  }>();

  for (const unit of units) {
    if (unit.source !== 'packageVisit') continue;
    const blocked = unit.kind === 'blocked';
    const scheduledUnassigned = unit.kind === 'notStarted' && !unit.assigned;
    if (!blocked && !scheduledUnassigned) continue;
    const communityId = unit.communityId?.trim();
    const visitWindowId = unit.visitWindowId?.trim();
    if (!communityId || !visitWindowId) continue;
    const key = `${communityId}\u0000${visitWindowId}`;
    const current = groups.get(key) ?? {
      communityId,
      ...(unit.visitWindowName ? { visitWindowName: unit.visitWindowName } : {}),
      visitWindowId,
      visitIds: new Set<string>(),
      blockedCount: 0,
      unassignedCount: 0,
    };
    current.visitIds.add(unit.id);
    if (blocked) current.blockedCount += 1;
    if (!unit.assigned) current.unassignedCount += 1;
    if (!current.visitWindowName && unit.visitWindowName) {
      current.visitWindowName = unit.visitWindowName;
    }
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((group) => ({
      communityId: group.communityId,
      ...(group.communityName ? { communityName: group.communityName } : {}),
      visitWindowId: group.visitWindowId,
      ...(group.visitWindowName ? { visitWindowName: group.visitWindowName } : {}),
      visitCount: group.visitIds.size,
      blockedCount: group.blockedCount,
      unassignedCount: group.unassignedCount,
    }))
    .sort((left, right) =>
      (right.blockedCount + right.unassignedCount) - (left.blockedCount + left.unassignedCount)
      || left.communityId.localeCompare(right.communityId)
      || left.visitWindowId.localeCompare(right.visitWindowId));
}

function communityUnassigned(units: readonly HomeWorkUnit[]): VendorHomeUpcomingCommunity[] {
  const groups = new Map<string, { communityId: string; communityName?: string; visitCount: number; unassignedCount: number }>();
  for (const unit of units) {
    const communityId = unit.communityId?.trim();
    if (!communityId) continue;
    const current = groups.get(communityId) ?? {
      communityId,
      visitCount: 0,
      unassignedCount: 0,
    };
    current.visitCount += 1;
    if (!unit.assigned) current.unassignedCount += 1;
    groups.set(communityId, current);
  }
  return [...groups.values()]
    .filter((group) => group.unassignedCount > 0)
    .map((group) => ({
      communityId: group.communityId,
      ...(group.communityName ? { communityName: group.communityName } : {}),
      visitCount: group.visitCount,
      unassignedCount: group.unassignedCount,
    }))
    .sort((left, right) =>
      right.unassignedCount - left.unassignedCount
      || left.communityId.localeCompare(right.communityId));
}

function visitKind(status: PackageVisitStatus): HomeWorkKind | null {
  if (countsAs(status, HOME_SUMMARY_VISIT_STATUS.completed)) return 'completed';
  if (countsAs(status, HOME_SUMMARY_VISIT_STATUS.inProgress)) return 'inProgress';
  if (countsAs(status, HOME_SUMMARY_VISIT_STATUS.notStarted)) return 'notStarted';
  if (countsAs(status, HOME_SUMMARY_VISIT_STATUS.blocked)) return 'blocked';
  if (countsAs(status, HOME_SUMMARY_VISIT_STATUS.missed)) return 'missed';
  if (countsAs(status, HOME_SUMMARY_VISIT_STATUS.cancelled)) return 'cancelled';
  return null;
}

function bookingKind(status: string): HomeWorkKind | null {
  if ((HOME_SUMMARY_BOOKING_STATUS.completed as readonly string[]).includes(status)) return 'completed';
  if ((HOME_SUMMARY_BOOKING_STATUS.inProgress as readonly string[]).includes(status)) return 'inProgress';
  if ((HOME_SUMMARY_BOOKING_STATUS.notStarted as readonly string[]).includes(status)) return 'notStarted';
  if ((HOME_SUMMARY_BOOKING_STATUS.cancelled as readonly string[]).includes(status)) return 'cancelled';
  return null;
}

function bookingCommunityId(booking: Booking): string | null {
  const location = booking.location;
  if (!location || location.fulfilmentType !== 'community') return null;
  const communityId = location.communityId?.trim();
  return communityId || null;
}

function countsAs(status: PackageVisitStatus, group: readonly PackageVisitStatus[]): boolean {
  return group.includes(status);
}

function completionPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

function parseUpcomingDays(raw: string | undefined): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_UPCOMING_DAYS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_UPCOMING_DAYS || value > MAX_UPCOMING_DAYS) {
    throw new ValidationError(`upcomingDays must be an integer from ${MIN_UPCOMING_DAYS} to ${MAX_UPCOMING_DAYS}`);
  }
  return value;
}

function requireDate(value: string, field: string): string {
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ValidationError(`${field} must be YYYY-MM-DD`);
  }
  return value;
}
