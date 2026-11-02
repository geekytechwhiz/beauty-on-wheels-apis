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
  eachDate,
  inclusiveDayCount,
} from './vendor-package-visits';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_OPERATIONS_SUMMARY_DAYS = 14;

/**
 * Aggregation rules (documented for tests and OpenAPI):
 *
 * expected
 *   Package visits: SCHEDULED + IN_PROGRESS + COMPLETED + MISSED.
 *   One-time bookings: CONFIRMED + CHECKED_IN + IN_PROGRESS + COMPLETED.
 *   Includes missed package visits. Excludes CANCELLED and UNSCHEDULED visits,
 *   and excludes CREATED / PENDING / PENDING_PAYMENT bookings.
 *
 * completed / inProgress / waiting / missed / cancelled
 *   Package visits: COMPLETED, IN_PROGRESS, SCHEDULED, MISSED, CANCELLED.
 *   One-time bookings: COMPLETED, IN_PROGRESS, CONFIRMED|CHECKED_IN, (none), CANCELLED.
 *   Bookings have no MISSED status.
 *
 * cancelled vs expected
 *   Cancelled work is counted only in metrics.cancelled and is excluded from expected.
 *
 * communities[].scheduled
 *   Per-community expected count. Sum of communities[].scheduled is ≤ metrics.expected
 *   when some work has no communityId (unassigned stays in global totals only).
 *
 * one-time bookings → community / window
 *   communityId comes from location.communityId when fulfilmentType is community.
 *   visitWindowId / visitWindowName are not stored on bookings → null in needsAttention.
 *   Data-model gap: one-time bookings cannot be grouped by service window.
 *
 * duplicates
 *   Bookings with planId are package-linked jobs and are excluded; PackageVisit is canonical.
 */

export const OPERATIONS_SUMMARY_METRIC_STATUS = {
  visitExpected: [
    PACKAGE_VISIT_STATUS.SCHEDULED,
    PACKAGE_VISIT_STATUS.IN_PROGRESS,
    PACKAGE_VISIT_STATUS.COMPLETED,
    PACKAGE_VISIT_STATUS.MISSED,
  ],
  visitCompleted: [PACKAGE_VISIT_STATUS.COMPLETED],
  visitInProgress: [PACKAGE_VISIT_STATUS.IN_PROGRESS],
  visitWaiting: [PACKAGE_VISIT_STATUS.SCHEDULED],
  visitMissed: [PACKAGE_VISIT_STATUS.MISSED],
  visitCancelled: [PACKAGE_VISIT_STATUS.CANCELLED],
  bookingExpected: ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'] as const,
  bookingCompleted: ['COMPLETED'] as const,
  bookingInProgress: ['IN_PROGRESS'] as const,
  bookingWaiting: ['CONFIRMED', 'CHECKED_IN'] as const,
  bookingCancelled: ['CANCELLED'] as const,
} as const;

export interface VendorOperationsMetrics {
  expected: number;
  completed: number;
  inProgress: number;
  waiting: number;
  missed: number;
  cancelled: number;
}

export interface VendorOperationsAttentionGroup {
  communityId: string | null;
  visitWindowId: string | null;
  visitWindowName: string | null;
  waiting: number;
}

export interface VendorOperationsCommunitySummary {
  communityId: string;
  scheduled: number;
  completed: number;
  inProgress: number;
  waiting: number;
}

export interface VendorOperationsSummary {
  fromDate: string;
  toDate: string;
  timezone: string;
  metrics: VendorOperationsMetrics;
  needsAttention: VendorOperationsAttentionGroup[];
  communities: VendorOperationsCommunitySummary[];
}

export type OperationsWorkKind = 'completed' | 'inProgress' | 'waiting' | 'missed' | 'cancelled';

export interface OperationsWorkUnit {
  source: 'packageVisit' | 'oneTimeBooking';
  id: string;
  date: string;
  timezone?: string;
  communityId: string | null;
  visitWindowId: string | null;
  visitWindowName: string | null;
  /** Contributes to expected when true. Cancelled units are never expected. */
  expected: boolean;
  kind: OperationsWorkKind;
}

export const VendorOperationsSummarySchema = z.object({
  fromDate: z.string().regex(DATE_PATTERN),
  toDate: z.string().regex(DATE_PATTERN),
  timezone: z.string().min(1),
  metrics: z.object({
    expected: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
    missed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
  }),
  needsAttention: z.array(z.object({
    communityId: z.string().nullable(),
    visitWindowId: z.string().nullable(),
    visitWindowName: z.string().nullable(),
    waiting: z.number().int().positive(),
  })),
  communities: z.array(z.object({
    communityId: z.string().min(1),
    scheduled: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
  })),
});

export function parseOperationsSummaryRange(
  query: Record<string, string | undefined> | null | undefined,
): { fromDate: string; toDate: string } {
  const source = query ?? {};
  const fromRaw = source.fromDate?.trim();
  const toRaw = source.toDate?.trim();
  if (!fromRaw) throw new ValidationError('fromDate is required');
  if (!toRaw) throw new ValidationError('toDate is required');
  const fromDate = requireDate(fromRaw, 'fromDate');
  const toDate = requireDate(toRaw, 'toDate');
  if (fromDate > toDate) throw new ValidationError('fromDate must be on or before toDate');
  if (inclusiveDayCount(fromDate, toDate) > MAX_OPERATIONS_SUMMARY_DAYS) {
    throw new ValidationError(`Summary range cannot exceed ${MAX_OPERATIONS_SUMMARY_DAYS} days`);
  }
  return { fromDate, toDate };
}

export function assertIanaTimezone(value: string, field = 'timezone'): string {
  const timezone = value.trim();
  if (!timezone) {
    throw new BookingError(
      'VENDOR_TIMEZONE_UNRESOLVED',
      'Vendor timezone could not be resolved',
      409,
      field,
      false,
    );
  }
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new BookingError(
      'VENDOR_TIMEZONE_INVALID',
      'Vendor timezone is not a valid IANA time zone',
      409,
      field,
      false,
    );
  }
  return timezone;
}

/**
 * Resolves the vendor operational timezone from real stored schedule timezones.
 * Does not fall back to Lambda UTC or a hard-coded zone.
 */
export function resolveVendorTimezone(candidates: readonly (string | undefined)[]): string {
  const unique = [...new Set(
    candidates
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  )];
  if (unique.length === 0) {
    throw new BookingError(
      'VENDOR_TIMEZONE_UNRESOLVED',
      'Vendor timezone could not be resolved from stored schedules',
      409,
      'timezone',
      false,
    );
  }
  if (unique.length > 1) {
    throw new BookingError(
      'VENDOR_TIMEZONE_AMBIGUOUS',
      'Vendor has conflicting timezones across scheduled work',
      409,
      'timezone',
      false,
    );
  }
  return assertIanaTimezone(unique[0]);
}

export function packageVisitToWorkUnit(visit: PackageVisitRecord): OperationsWorkUnit | null {
  const date = visit.schedule?.date?.trim();
  if (!date || visit.status === PACKAGE_VISIT_STATUS.UNSCHEDULED) return null;
  const kind = visitKind(visit.status);
  if (!kind) return null;
  const expected = countsAs(visit.status, OPERATIONS_SUMMARY_METRIC_STATUS.visitExpected);
  return {
    source: 'packageVisit',
    id: visit.visitId,
    date,
    ...(visit.schedule?.timezone ? { timezone: visit.schedule.timezone } : {}),
    communityId: visit.communityId?.trim() || null,
    visitWindowId: visit.visitWindowId?.trim() || null,
    visitWindowName: visit.visitWindowName?.trim() || null,
    expected,
    kind,
  };
}

/**
 * One-time bookings only. Package-linked bookings (planId set) are skipped so the
 * PackageVisit row remains the single operational representation.
 */
export function oneTimeBookingToWorkUnit(booking: Booking): OperationsWorkUnit | null {
  if (booking.planId?.trim()) return null;
  const date = (booking.schedule?.date ?? booking.bookingDate)?.trim();
  if (!date) return null;
  const status = booking.bookingStatus;
  if (!status) return null;
  const kind = bookingKind(status);
  if (!kind) return null;
  const expected = (OPERATIONS_SUMMARY_METRIC_STATUS.bookingExpected as readonly string[])
    .includes(status);
  return {
    source: 'oneTimeBooking',
    id: booking.id ?? '',
    date,
    ...(booking.schedule?.timezone ? { timezone: booking.schedule.timezone } : {}),
    communityId: bookingCommunityId(booking),
    visitWindowId: null,
    visitWindowName: null,
    expected,
    kind,
  };
}

export function summarizeVendorOperations(input: {
  visits: readonly PackageVisitRecord[];
  bookings: readonly Booking[];
  fromDate: string;
  toDate: string;
  timezone: string;
}): VendorOperationsSummary {
  const timezone = assertIanaTimezone(input.timezone);
  const units = [
    ...input.visits.map(packageVisitToWorkUnit),
    ...input.bookings.map(oneTimeBookingToWorkUnit),
  ].filter((unit): unit is OperationsWorkUnit => Boolean(unit))
    .filter((unit) => unit.date >= input.fromDate && unit.date <= input.toDate);

  if (units.length > SUMMARY_VISIT_CAP) {
    throw new BookingError(
      'SUMMARY_TOO_LARGE',
      'Narrow the date range. Totals are not returned for a partial read.',
      409,
      'toDate',
      false,
    );
  }

  return {
    fromDate: input.fromDate,
    toDate: input.toDate,
    timezone,
    metrics: metricsFor(units),
    needsAttention: attentionGroups(units),
    communities: communitySummaries(units),
  };
}

export function emptyOperationsSummary(
  fromDate: string,
  toDate: string,
  timezone: string,
): VendorOperationsSummary {
  return {
    fromDate,
    toDate,
    timezone: assertIanaTimezone(timezone),
    metrics: {
      expected: 0,
      completed: 0,
      inProgress: 0,
      waiting: 0,
      missed: 0,
      cancelled: 0,
    },
    needsAttention: [],
    communities: [],
  };
}

export { eachDate, addCalendarDays, SUMMARY_VISIT_CAP };

function metricsFor(units: readonly OperationsWorkUnit[]): VendorOperationsMetrics {
  const expectedUnits = units.filter((unit) => unit.expected);
  return {
    expected: expectedUnits.length,
    completed: expectedUnits.filter((unit) => unit.kind === 'completed').length,
    inProgress: expectedUnits.filter((unit) => unit.kind === 'inProgress').length,
    waiting: expectedUnits.filter((unit) => unit.kind === 'waiting').length,
    missed: expectedUnits.filter((unit) => unit.kind === 'missed').length,
    cancelled: units.filter((unit) => unit.kind === 'cancelled').length,
  };
}

function attentionGroups(units: readonly OperationsWorkUnit[]): VendorOperationsAttentionGroup[] {
  const groups = new Map<string, VendorOperationsAttentionGroup>();
  for (const unit of units) {
    if (unit.kind !== 'waiting') continue;
    const key = `${unit.communityId ?? ''}\u0000${unit.visitWindowId ?? ''}`;
    const current = groups.get(key) ?? {
      communityId: unit.communityId,
      visitWindowId: unit.visitWindowId,
      visitWindowName: unit.visitWindowName,
      waiting: 0,
    };
    current.waiting += 1;
    if (!current.visitWindowName && unit.visitWindowName) {
      current.visitWindowName = unit.visitWindowName;
    }
    groups.set(key, current);
  }
  return [...groups.values()]
    .filter((group) => group.waiting > 0)
    .sort((left, right) =>
      right.waiting - left.waiting
      || String(left.communityId ?? '').localeCompare(String(right.communityId ?? ''))
      || String(left.visitWindowId ?? '').localeCompare(String(right.visitWindowId ?? '')));
}

function communitySummaries(
  units: readonly OperationsWorkUnit[],
): VendorOperationsCommunitySummary[] {
  const groups = new Map<string, OperationsWorkUnit[]>();
  for (const unit of units) {
    if (!unit.expected || !unit.communityId) continue;
    groups.set(unit.communityId, [...(groups.get(unit.communityId) ?? []), unit]);
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
      };
    })
    .sort((left, right) =>
      right.scheduled - left.scheduled || left.communityId.localeCompare(right.communityId));
}

function visitKind(status: PackageVisitStatus): OperationsWorkKind | null {
  if (countsAs(status, OPERATIONS_SUMMARY_METRIC_STATUS.visitCompleted)) return 'completed';
  if (countsAs(status, OPERATIONS_SUMMARY_METRIC_STATUS.visitInProgress)) return 'inProgress';
  if (countsAs(status, OPERATIONS_SUMMARY_METRIC_STATUS.visitWaiting)) return 'waiting';
  if (countsAs(status, OPERATIONS_SUMMARY_METRIC_STATUS.visitMissed)) return 'missed';
  if (countsAs(status, OPERATIONS_SUMMARY_METRIC_STATUS.visitCancelled)) return 'cancelled';
  return null;
}

function bookingKind(status: string): OperationsWorkKind | null {
  if ((OPERATIONS_SUMMARY_METRIC_STATUS.bookingCompleted as readonly string[]).includes(status)) {
    return 'completed';
  }
  if ((OPERATIONS_SUMMARY_METRIC_STATUS.bookingInProgress as readonly string[]).includes(status)) {
    return 'inProgress';
  }
  if ((OPERATIONS_SUMMARY_METRIC_STATUS.bookingWaiting as readonly string[]).includes(status)) {
    return 'waiting';
  }
  if ((OPERATIONS_SUMMARY_METRIC_STATUS.bookingCancelled as readonly string[]).includes(status)) {
    return 'cancelled';
  }
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

function requireDate(value: string, field: string): string {
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ValidationError(`${field} must be YYYY-MM-DD`);
  }
  return value;
}
