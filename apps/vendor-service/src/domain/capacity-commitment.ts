import { createHash } from 'crypto';

import { ConflictError, ValidationError } from '@api-hub/utils';

import { DayOfWeek } from '../types/api-types';

/**
 * CAPACITY UNIT
 * -------------
 * Commitment `quantity` = workload slot-units **per service-window day**.
 *
 * One slot-unit ≈ {@link CAPACITY_SLOT_MINUTES} minutes of service work.
 *
 * Plan lifetime demand (booking `planVisitSlotDemand`) = sum over entitlements of
 *   quantity * max(1, ceil(durationMinutes / CAPACITY_SLOT_MINUTES)).
 * That is a **period** total (all visits in the plan), not a daily quantity.
 *
 * Sales paths must compare matching grains:
 * - **Payment hold/confirm** — period eligibility: periodDemand vs
 *   `quantity * serviceDays(window)`. Claims `claimedPeriodQuantity` on the
 *   commitment; does **not** debit daily slot capacity.
 * - **Visit schedule** — daily debit: visitSlotUnits(duration) against that
 *   date’s day ledger (`CommitmentDaySold`), capped by `quantity`.
 *
 * Legacy plan reservations (pre period-eligibility) stored lifetime demand in
 * `reservedSoldQuantity` on the commitment. Those rows still release via the
 * legacy debit path (`consumesDailySlots !== false` with no `claimedPeriodQuantity`).
 *
 * A vendor's crew daily capacity (accept-time only) is:
 *   activeCrewCount * maxVisitsPerCrewPerDay          (default 4 slot-units per crew per day)
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
   * Legacy / visit-aggregate counter. New payment holds claim
   * {@link claimedPeriodQuantity} instead. Visit schedule debits the per-day
   * ledger; this field may still be updated for legacy plan-level slot debits.
   */
  reservedSoldQuantity: number;
  /**
   * Period slot-units claimed by plan purchase holds/sales (same unit as plan
   * lifetime demand). Compared to `quantity * serviceDays(window)`, not to
   * the daily `quantity` alone. Absent on pre-migration rows (= 0).
   */
  claimedPeriodQuantity?: number;
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
 *
 * `quantity` is the plan's period demand (lifetime visit-slot units). New rows set
 * `consumesDailySlots: false` and claim period capacity only. Legacy rows omit the
 * flag (treated as true) and debited `reservedSoldQuantity` at payment time.
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
  /**
   * false = period eligibility claim only (default for new writes).
   * true / absent = legacy payment-time daily-pool debit of `quantity`.
   */
  consumesDailySlots?: boolean;
  /** Present on holds; ignored once converted to sold. */
  expiresAt?: string;
  paymentId?: string;
  createdAt: string;
  updatedAt?: string;
  entityType: 'PlanSoldCapacityReservation';
}

/**
 * Per-visit sold capacity debit against a commitment service day.
 * Written when a package visit receives an actual date + window.
 */
export interface VisitSoldCapacityReservationDdbItem {
  PK: string;
  SK: string;
  visitId: string;
  planId: string;
  vendorId: string;
  commitmentId: string;
  /** Civil date YYYY-MM-DD the visit consumes. */
  date: string;
  /** Visit slot-units for this occurrence (not plan lifetime demand). */
  quantity: number;
  startTime?: string;
  endTime?: string;
  createdAt: string;
  updatedAt?: string;
  entityType: 'VisitSoldCapacityReservation';
}

/**
 * Daily sold ledger for one commitment service day.
 * `reservedSoldQuantity` is capped by the commitment's per-day `quantity`.
 */
export interface CommitmentDaySoldDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  commitmentId: string;
  date: string;
  reservedSoldQuantity: number;
  updatedAt: string;
  entityType: 'CommitmentDaySold';
}

/** True when the plan pointer debits the legacy commitment reservedSoldQuantity pool. */
export function planReservationConsumesDailySlots(
  item: Pick<PlanSoldCapacityReservationDdbItem, 'consumesDailySlots'>,
): boolean {
  return item.consumesDailySlots !== false;
}

/** Period supply for a commitment: daily quantity × served civil dates in the window. */
export function commitmentPeriodSupply(
  commitment: Pick<CapacityCommitmentDdbItem, 'quantity' | 'window'>,
): number {
  return commitment.quantity * expandWindowDates(commitment.window).length;
}

export function claimedPeriodQuantityOf(
  commitment: Pick<CapacityCommitmentDdbItem, 'claimedPeriodQuantity'>,
): number {
  return commitment.claimedPeriodQuantity ?? 0;
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
/**
 * Civil-date weekday for YYYY-MM-DD. Dates are interpreted as UTC calendar days so
 * weekday is stable for the product timezone (Asia/Kolkata) and never shifts around
 * local midnights. Do not parse with `new Date('YYYY-MM-DD')` in a local zone.
 */
const WEEKDAYS: DayOfWeek[] = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

/** Product / ops civil calendar. Capacity day-of-week uses UTC civil dates (see WEEKDAYS). */
export const CAPACITY_BUSINESS_TIMEZONE = 'Asia/Kolkata';

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

/** True when the window serves the given civil date (range + daysOfWeek). */
export function windowServesDate(window: ServiceWindow, date: string): boolean {
  if (date < window.startDate || date > window.endDate) {
    return false;
  }
  if (!window.daysOfWeek?.length) {
    return true;
  }
  return window.daysOfWeek.includes(WEEKDAYS[new Date(parseDate(date)).getUTCDay()]);
}

/** True when two daily HH:mm windows overlap (overnight unsupported). */
export function dailyWindowsOverlap(a: DailyWindow, b: DailyWindow): boolean {
  return toMinutes(a.startTime) < toMinutes(b.endTime)
    && toMinutes(b.startTime) < toMinutes(a.endTime);
}

/**
 * True when the commitment can serve at least one of the plan's preferred weekdays.
 * Omitted/empty preferred days → any commitment day list is accepted.
 * Omitted/empty commitment daysOfWeek → every civil day (API contract) → accepted.
 */
export function commitmentCoversPreferredDays(
  window: Pick<ServiceWindow, 'daysOfWeek'>,
  preferredDays: readonly DayOfWeek[] | undefined,
): boolean {
  if (!preferredDays?.length) return true;
  if (!window.daysOfWeek?.length) return true;
  const served = new Set(window.daysOfWeek);
  return preferredDays.some((day) => served.has(day));
}

/**
 * True when a scheduled visit interval [startTime, endTime) fits inside the
 * commitment daily window (same HH:mm convention; overnight unsupported).
 */
export function visitFitsDailyWindow(
  window: DailyWindow,
  startTime: string,
  endTime: string,
): boolean {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (!(end > start)) {
    return false;
  }
  return start >= toMinutes(window.startTime) && end <= toMinutes(window.endTime);
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

/**
 * Crew shortage implied by peak overlapping load + requested quantity against the
 * configured per-crew daily visit limit. Matches the accept-time capacity guard.
 */
export function crewShortageForCapacity(input: {
  peakCommittedQuantity: number;
  requestedQuantity: number;
  activeCrewCount: number;
  maxVisitsPerCrewPerDay: number;
}): {
  requiredCrewCount: number;
  additionalCrewCount: number;
  capacityPerDay: number;
} {
  const activeCrewCount = Math.max(0, input.activeCrewCount);
  const maxVisitsPerCrewPerDay = Math.max(0, input.maxVisitsPerCrewPerDay);
  const capacityPerDay = dailyCapacity(activeCrewCount, maxVisitsPerCrewPerDay);
  const totalLoad = Math.max(0, input.peakCommittedQuantity) + Math.max(0, input.requestedQuantity);
  const requiredCrewCount =
    maxVisitsPerCrewPerDay > 0
      ? Math.ceil(totalLoad / maxVisitsPerCrewPerDay)
      : totalLoad > 0
        ? activeCrewCount + 1
        : 0;
  return {
    requiredCrewCount,
    additionalCrewCount: Math.max(0, requiredCrewCount - activeCrewCount),
    capacityPerDay,
  };
}

function pluralCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Vendor-facing CAPACITY_EXCEEDED copy; singular/plural aware. */
export function capacityExceededMessage(input: {
  additionalCrewCount: number;
  activeCrewCount: number;
  requiredCrewCount: number;
  requestedQuantity: number;
  peakCommittedQuantity: number;
}): string {
  const need = `You need ${pluralCount(input.additionalCrewCount, 'more active crew', 'more active crews')} to accept this proposal.`;
  const have = `You have ${pluralCount(input.activeCrewCount, 'active crew', 'active crews')}`;
  const requiredVerb = input.requiredCrewCount === 1 ? 'is' : 'are';
  if (input.peakCommittedQuantity > 0) {
    return (
      `${need} ${have}; ${input.requiredCrewCount} ${requiredVerb} required for `
      + `${pluralCount(input.requestedQuantity, 'requested visit', 'requested visits')} plus `
      + `${pluralCount(input.peakCommittedQuantity, 'already committed visit', 'already committed visits')} `
      + 'on the busiest overlapping day.'
    );
  }
  return (
    `${need} ${have}; ${input.requiredCrewCount} ${requiredVerb} required for `
    + `${pluralCount(input.requestedQuantity, 'visit', 'visits')} per service day.`
  );
}

/**
 * Throws 409 when `quantity` would push any day of `window` past the vendor's daily
 * crew capacity (`activeCrewCount × maxVisitsPerCrewPerDay`).
 */
export function assertCapacityAvailable(input: {
  commitments: readonly CommittedLoad[];
  window: ServiceWindow;
  quantity: number;
  activeCrewCount: number;
  maxVisitsPerCrewPerDay: number;
}): void {
  const { peak, date } = peakCommittedQuantity(input.commitments, input.window);
  const activeCrewCount = Math.max(0, input.activeCrewCount);
  const maxVisitsPerCrewPerDay = Math.max(0, input.maxVisitsPerCrewPerDay);
  const { requiredCrewCount, additionalCrewCount, capacityPerDay } = crewShortageForCapacity({
    peakCommittedQuantity: peak,
    requestedQuantity: input.quantity,
    activeCrewCount,
    maxVisitsPerCrewPerDay,
  });
  if (peak + input.quantity > capacityPerDay) {
    const message = capacityExceededMessage({
      additionalCrewCount,
      activeCrewCount,
      requiredCrewCount,
      requestedQuantity: input.quantity,
      peakCommittedQuantity: peak,
    });
    throw new ConflictError(message, [
      {
        code: 'CAPACITY_EXCEEDED',
        field: 'quantity',
        message,
        activeCrewCount,
        requiredCrewCount,
        additionalCrewCount,
        maxVisitsPerCrewPerDay,
        peakCommittedQuantity: peak,
        requestedQuantity: input.quantity,
        capacityPerDay,
        peakDate: date,
      },
    ]);
  }
}
