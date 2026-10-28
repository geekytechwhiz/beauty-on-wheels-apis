import { hasBookableCapacity, type CapacityCounters } from './capacity';
import { isValidTime, timeToMinutes, addMinutes } from './time';

/**
 * Generated slots are fixed, non-overlapping capacity blocks tiled across
 * working hours. A booking occupies every block that intersects the requested
 * interval. Empty serviceIds or vehicleTypeIds mean the block is unrestricted.
 *
 * DynamoDB TransactWrite allows 25 items. A reservation writes one update per
 * block plus the allocation and the booking lookup.
 */
export const MAX_COVERED_BLOCKS = 23;

/** Slot generation rejects durations above 240 minutes. */
export const MAX_SLOT_LOOKBACK_MINUTES = 240;

export const RESERVATION_REJECTION = {
  NO_SLOT_FOUND: 'NO_SLOT_FOUND',
  SERVICE_NOT_SUPPORTED: 'SERVICE_NOT_SUPPORTED',
  VEHICLE_TYPE_NOT_SUPPORTED: 'VEHICLE_TYPE_NOT_SUPPORTED',
  INSUFFICIENT_DURATION: 'INSUFFICIENT_DURATION',
  INSUFFICIENT_CAPACITY: 'INSUFFICIENT_CAPACITY',
  SLOT_BLOCKED: 'SLOT_BLOCKED',
  OUTSIDE_WORKING_HOURS: 'OUTSIDE_WORKING_HOURS',
  OVERLAPPING_RESERVATION: 'OVERLAPPING_RESERVATION',
  TIMEZONE_MISMATCH: 'TIMEZONE_MISMATCH',
} as const;

export type ReservationRejection =
  (typeof RESERVATION_REJECTION)[keyof typeof RESERVATION_REJECTION];

export interface CoverageSlot {
  slotId: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  capacity: number;
  heldCount: number;
  bookedCount: number;
  status: string;
  serviceIds: string[];
  vehicleTypeIds: string[];
  timezone: string;
  vendorId: string;
  branchId: string;
  date: string;
  /** Days after the visit occurrence. Set on blocks that start after midnight. */
  startDayOffset?: number;
}

export interface CoverageRequest {
  vendorId?: string;
  branchId?: string;
  date?: string;
  startTime: string;
  /** Days after `date` when the requested start is on the next civil morning. */
  startDayOffset?: number;
  durationMinutes: number;
  offeringId?: string;
  vehicleType?: string;
  timezone?: string;
}

export interface CoverageSuccess<T extends CoverageSlot> {
  ok: true;
  slots: T[];
  anchor: T;
}

export interface CoverageFailure {
  ok: false;
  reason: ReservationRejection;
}

export function supportsService(serviceIds: readonly string[], serviceId?: string): boolean {
  if (!serviceId) {
    return true;
  }
  return serviceIds.length === 0 || serviceIds.includes(serviceId);
}

export function supportsVehicle(vehicleTypeIds: readonly string[], vehicleType?: string): boolean {
  if (!vehicleType) {
    return true;
  }
  if (vehicleTypeIds.length === 0) {
    return true;
  }
  const wanted = vehicleType.toLowerCase();
  return vehicleTypeIds.some((type) => type.toLowerCase() === wanted);
}

export function slotQueryBounds(
  startTime: string,
  durationMinutes: number,
): { fromTime: string; toTimeExclusive: string } {
  const start = timeToMinutes(startTime);
  const from = Math.max(0, start - MAX_SLOT_LOOKBACK_MINUTES);
  const end = Math.min(start + durationMinutes, 48 * 60);
  return {
    fromTime: addMinutes('00:00', from),
    toTimeExclusive: addMinutes('00:00', end),
  };
}

export function selectCapacityBlocks<T extends CoverageSlot>(
  slots: readonly T[],
  request: CoverageRequest,
): CoverageSuccess<T> | CoverageFailure {
  const start = timeToMinutes(request.startTime) + (request.startDayOffset ?? 0) * 1440;
  const end = start + request.durationMinutes;
  if (!isValidTime(request.startTime) || request.durationMinutes < 1 || end > 48 * 60) {
    return { ok: false, reason: RESERVATION_REJECTION.OUTSIDE_WORKING_HOURS };
  }

  const overlapping = slots.filter((slot) => {
    if (request.vendorId && slot.vendorId !== request.vendorId) {
      return false;
    }
    if (request.branchId && slot.branchId !== request.branchId) {
      return false;
    }
    if (request.date && slot.date !== request.date) {
      return false;
    }
    return intersects(slot, start, end);
  });
  if (overlapping.length === 0) {
    return { ok: false, reason: RESERVATION_REJECTION.NO_SLOT_FOUND };
  }

  const timezoneMatched = request.timezone
    ? overlapping.filter((slot) => slot.timezone === request.timezone)
    : overlapping;
  if (timezoneMatched.length === 0) {
    return { ok: false, reason: RESERVATION_REJECTION.TIMEZONE_MISMATCH };
  }

  const serviceMatched = timezoneMatched.filter((slot) =>
    supportsService(slot.serviceIds, request.offeringId),
  );
  if (serviceMatched.length === 0) {
    return { ok: false, reason: RESERVATION_REJECTION.SERVICE_NOT_SUPPORTED };
  }

  const applicable = serviceMatched.filter((slot) =>
    supportsVehicle(slot.vehicleTypeIds, request.vehicleType),
  );
  if (applicable.length === 0) {
    return { ok: false, reason: RESERVATION_REJECTION.VEHICLE_TYPE_NOT_SUPPORTED };
  }
  if (applicable.some((slot) => slot.status === 'blocked')) {
    return { ok: false, reason: RESERVATION_REJECTION.SLOT_BLOCKED };
  }
  if (!coversInterval(applicable, start, end)) {
    return { ok: false, reason: RESERVATION_REJECTION.INSUFFICIENT_DURATION };
  }

  const lacking = applicable.filter((slot) => !hasBookableCapacity(slot as CapacityCounters, 1));
  if (lacking.length > 0) {
    const free = applicable.filter((slot) => hasBookableCapacity(slot as CapacityCounters, 1));
    return {
      ok: false,
      reason: coversInterval(free, start, end)
        ? RESERVATION_REJECTION.OVERLAPPING_RESERVATION
        : RESERVATION_REJECTION.INSUFFICIENT_CAPACITY,
    };
  }
  if (applicable.length > MAX_COVERED_BLOCKS) {
    return { ok: false, reason: RESERVATION_REJECTION.INSUFFICIENT_DURATION };
  }

  const selected = [...applicable].sort(byWindow);
  const anchor = selected.find((slot) => slot.startTime === request.startTime) ?? selected[0];
  return { ok: true, slots: selected, anchor };
}

function intersects(slot: CoverageSlot, start: number, end: number): boolean {
  const range = absoluteRange(slot);
  if (!range) {
    return false;
  }
  return range.start < end && range.end > start;
}

function coversInterval(slots: readonly CoverageSlot[], start: number, end: number): boolean {
  let cursor = start;
  const ordered = [...slots].sort(byWindow);
  for (const slot of ordered) {
    const range = absoluteRange(slot);
    if (!range || range.end <= cursor) {
      continue;
    }
    if (range.start > cursor) {
      return false;
    }
    cursor = range.end;
    if (cursor >= end) {
      return true;
    }
  }
  return cursor >= end;
}

function absoluteRange(slot: CoverageSlot): { start: number; end: number } | null {
  const clock = clockMinutes(slot.startTime);
  if (clock === null || slot.durationMinutes < 1) {
    return null;
  }
  const start = (slot.startDayOffset ?? 0) * 1440 + clock;
  return { start, end: start + slot.durationMinutes };
}

function clockMinutes(value: string): number | null {
  if (!isValidTime(value)) {
    return null;
  }
  return timeToMinutes(value);
}

function byWindow(left: CoverageSlot, right: CoverageSlot): number {
  const leftStart = (left.startDayOffset ?? 0) * 1440 + (clockMinutes(left.startTime) ?? 0);
  const rightStart = (right.startDayOffset ?? 0) * 1440 + (clockMinutes(right.startTime) ?? 0);
  return leftStart - rightStart || left.slotId.localeCompare(right.slotId);
}
