import { createHash } from 'crypto';

import { ConflictError, ValidationError } from '@api-hub/utils';

import { DayOfWeek } from '../types/api-types';

/**
 * CAPACITY UNIT
 * -------------
 * `quantity` and `reservedSoldQuantity` are **workload slot-units** reserved PER
 * SERVICE-WINDOW DAY (not a calendar total over the window).
 *
 * One slot-unit ≈ {@link CAPACITY_SLOT_MINUTES} minutes of service work. Booking
 * computes plan demand as sum over entitlements of
 *   quantity * max(1, ceil(durationMinutes / CAPACITY_SLOT_MINUTES)).
 * Legacy plans without usable durations still consume 1 unit per entitlement.
 *
 * A vendor's daily capacity is:
 *   activeCrewCount * maxVisitsPerCrewPerDay          (default 4 slot-units per crew per day)
 *
 * A new commitment is allowed only when, for every day of its window, the quantity of
 * non-cancelled commitments (all communities) whose window covers that day AND whose daily
 * time range overlaps, plus the new quantity, stays within the daily capacity.
 *
 * Migration: existing commitments and reservations keep their stored integers. New
 * holds/sales may consume more units per visit when durations exceed one slot. Ops
 * should re-size commitments for long-wash packages; do not silently reinterpret old
 * rows as minute-weighted.
 *
 * TODO: derive per-day capacity from availability-service community visit capacity /
 * operating-hours productive slots once a cross-service read exists.
 */
export const CAPACITY_SLOT_MINUTES = 30;
export const DEFAULT_MAX_VISITS_PER_CREW_PER_DAY = 4;

/** Wire/persistence kinds for plan capacity pointers (camelCase). */
export const CAPACITY_RESERVATION_KIND = {
  HOLD: 'hold',
  SOLD: 'sold',
} as const;

export type CapacityReservationKind =
  (typeof CAPACITY_RESERVATION_KIND)[keyof typeof CAPACITY_RESERVATION_KIND];

export const CAPACITY_COMMITMENT_STATUS = {
  ACTIVE: 'ACTIVE',
  CHANGE_PENDING: 'CHANGE_PENDING',
  REDUCED: 'REDUCED',
  CANCELLED: 'CANCELLED',
} as const;

export type CapacityCommitmentStatus =
  (typeof CAPACITY_COMMITMENT_STATUS)[keyof typeof CAPACITY_COMMITMENT_STATUS];

/**
 * Statuses that still hold capacity. CANCELLED releases it. CHANGE_PENDING and REDUCED
 * keep holding their recorded quantity until the change is finalized.
 */
export const CAPACITY_HOLDING_STATUSES: readonly CapacityCommitmentStatus[] = [
  CAPACITY_COMMITMENT_STATUS.ACTIVE,
  CAPACITY_COMMITMENT_STATUS.CHANGE_PENDING,
  CAPACITY_COMMITMENT_STATUS.REDUCED,
];

export const MAX_WINDOW_DAYS = 366;
export const MAX_PROPOSAL_QUANTITY = 1000;

export interface DailyWindow {
  /** HH:mm, 24h. Overnight windows are not supported. */
  startTime: string;
  endTime: string;
}

export interface ServiceWindow {
  /** YYYY-MM-DD civil dates, inclusive. */
  startDate: string;
  endDate: string;
  dailyWindow: DailyWindow;
  /** Omitted or empty = every day in the date range. */
  daysOfWeek?: DayOfWeek[];
}

export interface PayoutRate {
  amountMinor: number;
  currency: 'INR';
}

/**
 * Capacity scope is package-offering based.
 *
 * New writes always set `offeringId` (catalog package id) and never write
 * `serviceScopeCode`. Legacy rows may still carry `serviceScopeCode` and/or omit
 * `offeringId`; those remain readable but are ineligible for sales allocation
 * and sales-control enablement until migrated (see capacity-scope-offering-backfill).
 */
export interface PackageScope {
  /** Catalog package offering id. Required on all new writes. */
  offeringId?: string;
  /**
   * Legacy attribute only. May be present on pre-migration DynamoDB rows.
   * Never written by current proposal/commitment code paths.
   */
  serviceScopeCode?: string;
  label: string;
}

/** Normalized offering id when present; otherwise undefined (legacy / incomplete). */
export function packageScopeOfferingId(
  scope: Pick<PackageScope, 'offeringId'> | null | undefined,
): string | undefined {
  const value = scope?.offeringId?.trim();
  return value || undefined;
}

/**
 * Scope used for new commitment writes: offeringId + label only.
 * Strips legacy serviceScopeCode so accepts never re-persist it.
 */
export function packageScopeForWrite(scope: PackageScope): PackageScope {
  const offeringId = packageScopeOfferingId(scope);
  if (!offeringId) {
    throw new ValidationError(
      'packageScope.offeringId is required',
      [
        {
          code: 'CAPACITY_SCOPE_OFFERING_REQUIRED',
          field: 'packageScope.offeringId',
          message:
            'Capacity scope must identify a catalog package offeringId.'
            + ' Legacy rows that only have serviceScopeCode must be migrated first.',
        },
      ],
    );
  }
  const label = scope.label?.trim();
  if (!label) {
    throw new ValidationError('packageScope.label is required');
  }
  return { offeringId, label };
}

/** True when the commitment can participate in offering-scoped sales / eligibility. */
export function hasOfferingScopedCapacity(
  scope: Pick<PackageScope, 'offeringId'> | null | undefined,
): boolean {
  return Boolean(packageScopeOfferingId(scope));
}

export interface CapacityCommitmentDdbItem {
  PK: string;
  SK: string;
  commitmentId: string;
  proposalId: string;
  vendorId: string;
  communityId: string;
  scope: PackageScope;
  window: ServiceWindow;
  quantity: number;
  rate: PayoutRate;
  status: CapacityCommitmentStatus;
  /**
   * Slot-units held or sold against this commitment (same unit as `quantity`).
   * Includes unpaid checkout holds and paid sales. Decremented on hold release / refund.
   */
  reservedSoldQuantity: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  entityType: 'CapacityCommitment';
  /**
   * Operations index. Present on commitments written or status-updated after the
   * cross-vendor list shipped. Absent on older rows until they are rewritten.
   */
  GSI1PK?: string;
  GSI1SK?: string;
  GSI3PK?: string;
  GSI3SK?: string;
}

/**
 * Idempotency pointer for plan checkout hold → sold conversion (keyed by planId).
 * Absent `kind` on legacy rows means sold (payment-time reserve before holds existed).
 */
export interface PlanSoldCapacityReservationDdbItem {
  PK: string;
  SK: string;
  planId: string;
  vendorId: string;
  commitmentId: string;
  quantity: number;
  idempotencyKey: string;
  /** hold = unpaid checkout; sold = paid. Legacy rows without kind are treated as sold. */
  kind?: CapacityReservationKind;
  /** Present on holds; ignored once converted to sold. */
  expiresAt?: string;
  paymentId?: string;
  createdAt: string;
  updatedAt?: string;
  entityType: 'PlanSoldCapacityReservation';
}

export function reservationKindOf(
  item: Pick<PlanSoldCapacityReservationDdbItem, 'kind'>,
): CapacityReservationKind {
  return item.kind === CAPACITY_RESERVATION_KIND.HOLD
    ? CAPACITY_RESERVATION_KIND.HOLD
    : CAPACITY_RESERVATION_KIND.SOLD;
}

export function isHoldExpired(
  item: Pick<PlanSoldCapacityReservationDdbItem, 'kind' | 'expiresAt'>,
  nowMs: number = Date.now(),
): boolean {
  if (reservationKindOf(item) !== CAPACITY_RESERVATION_KIND.HOLD) return false;
  if (!item.expiresAt) return false;
  return Date.parse(item.expiresAt) <= nowMs;
}

export interface CapacityLedgerDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  /** Bumped by every commitment write for this vendor. Serializes concurrent accepts. */
  version: number;
  updatedAt: string;
  entityType: 'CapacityLedger';
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86_400_000;
const WEEKDAYS: DayOfWeek[] = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

/** One commitment per proposal, by construction. */
export function commitmentIdForProposal(proposalId: string): string {
  const digest = createHash('sha256').update(`commitment|${proposalId}`).digest('hex');
  return `cmt_${digest.slice(0, 24)}`;
}

export function dailyCapacity(
  activeCrewCount: number,
  maxVisitsPerCrewPerDay: number = DEFAULT_MAX_VISITS_PER_CREW_PER_DAY,
): number {
  return Math.max(0, activeCrewCount) * Math.max(0, maxVisitsPerCrewPerDay);
}

function parseDate(value: string): number {
  if (!DATE.test(value)) {
    throw new ValidationError(`Invalid date: ${value}`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
  ) {
    throw new ValidationError(`Invalid date: ${value}`);
  }
  return ms;
}

function toMinutes(value: string): number {
  if (!TIME.test(value)) {
    throw new ValidationError(`Invalid time: ${value}`);
  }
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Cross-field validation of a service window. Returns the window with days de-duplicated. */
export function validateServiceWindow(window: ServiceWindow): ServiceWindow {
  const start = parseDate(window.startDate);
  const end = parseDate(window.endDate);
  if (end < start) {
    throw new ValidationError('Service window endDate must not be before startDate');
  }
  if ((end - start) / DAY_MS + 1 > MAX_WINDOW_DAYS) {
    throw new ValidationError(`Service window cannot exceed ${MAX_WINDOW_DAYS} days`);
  }
  const from = toMinutes(window.dailyWindow.startTime);
  const to = toMinutes(window.dailyWindow.endTime);
  if (to <= from) {
    throw new ValidationError('Daily window endTime must be after startTime');
  }
  const daysOfWeek = window.daysOfWeek?.length
    ? [...new Set(window.daysOfWeek)]
    : undefined;
  const normalized: ServiceWindow = {
    startDate: window.startDate,
    endDate: window.endDate,
    dailyWindow: { ...window.dailyWindow },
    ...(daysOfWeek ? { daysOfWeek } : {}),
  };
  if (expandWindowDates(normalized).length === 0) {
    throw new ValidationError('Service window contains no service days');
  }
  return normalized;
}

/** Every civil date the window serves, honouring daysOfWeek. */
export function expandWindowDates(window: ServiceWindow): string[] {
  const start = parseDate(window.startDate);
  const end = parseDate(window.endDate);
  const days = window.daysOfWeek?.length ? new Set<DayOfWeek>(window.daysOfWeek) : undefined;
  const dates: string[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const date = new Date(ms);
    if (days && !days.has(WEEKDAYS[date.getUTCDay()])) {
      continue;
    }
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function windowServesDate(window: ServiceWindow, date: string): boolean {
  if (date < window.startDate || date > window.endDate) {
    return false;
  }
  if (!window.daysOfWeek?.length) {
    return true;
  }
  return window.daysOfWeek.includes(WEEKDAYS[new Date(parseDate(date)).getUTCDay()]);
}

function dailyWindowsOverlap(a: DailyWindow, b: DailyWindow): boolean {
  return toMinutes(a.startTime) < toMinutes(b.endTime)
    && toMinutes(b.startTime) < toMinutes(a.endTime);
}

/** True when two windows share at least one served day with overlapping daily time ranges. */
export function windowsOverlap(a: ServiceWindow, b: ServiceWindow): boolean {
  if (a.endDate < b.startDate || b.endDate < a.startDate) {
    return false;
  }
  if (!dailyWindowsOverlap(a.dailyWindow, b.dailyWindow)) {
    return false;
  }
  const bDates = new Set(expandWindowDates(b));
  return expandWindowDates(a).some((date) => bDates.has(date));
}

export interface CommittedLoad {
  window: ServiceWindow;
  quantity: number;
  status: CapacityCommitmentStatus;
}

/** Highest per-day committed quantity among holding commitments that overlap `window`. */
export function peakCommittedQuantity(
  commitments: readonly CommittedLoad[],
  window: ServiceWindow,
): { peak: number; date: string | null } {
  const holding = commitments.filter(
    (item) =>
      CAPACITY_HOLDING_STATUSES.includes(item.status)
      && windowsOverlap(item.window, window),
  );
  let peak = 0;
  let peakDate: string | null = null;
  for (const date of expandWindowDates(window)) {
    let load = 0;
    for (const item of holding) {
      if (
        windowServesDate(item.window, date)
        && dailyWindowsOverlap(item.window.dailyWindow, window.dailyWindow)
      ) {
        load += item.quantity;
      }
    }
    if (load > peak || peakDate === null) {
      peak = load;
      peakDate = date;
    }
  }
  return { peak, date: peakDate };
}

/** Throws 409 when `quantity` would push any day of `window` past the vendor's daily capacity. */
export function assertCapacityAvailable(input: {
  commitments: readonly CommittedLoad[];
  window: ServiceWindow;
  quantity: number;
  capacityPerDay: number;
}): void {
  const { peak, date } = peakCommittedQuantity(input.commitments, input.window);
  if (peak + input.quantity > input.capacityPerDay) {
    throw new ConflictError(
      'Accepting this proposal would exceed the vendor crew capacity for the service window',
      [
        {
          code: 'CAPACITY_EXCEEDED',
          field: 'quantity',
          message:
            `Day ${date}: committed ${peak} + requested ${input.quantity}`
            + ` exceeds daily capacity ${input.capacityPerDay}`,
        },
      ],
    );
  }
}
