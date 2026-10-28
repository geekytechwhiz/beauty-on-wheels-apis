import { createHash } from 'crypto';

import type { DayOfWeek } from './constants';
import { addCivilDays, weekdayOfCivilDate } from './time';
import type { VisitProjection } from './visit-projection';

export interface AtomicBlock {
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  startDayOffset: number;
  endDayOffset: 0 | 1;
  capacity: number;
  visitId: string;
  windowId: string;
  serviceIds: string[];
  timezone: string;
  branchId: string;
  vendorId: string;
}

export interface PlannedSlot {
  slotId: string;
  visitId: string;
  windowId: string;
  branchId: string;
  timezone: string;
  /** Civil date the service starts. */
  date: string;
  /** Window occurrence date. Overnight tails keep the previous occurrence. */
  occurrenceDate: string;
  clockStart: string;
  clockEnd: string;
  startDayOffset: number;
  endDayOffset: 0 | 1;
  durationMinutes: number;
  occupancyMinutes: number;
  capacity: number;
  /** Vendor tank size for this window. Absent when water does not limit the slot. */
  waterCapacityLiters?: number;
  /** Liters this service uses. Absent when the service does not declare water use. */
  waterLitersPerBooking?: number;
  blocks: AtomicBlock[];
}

export function branchKey(location: VisitProjection['location']): string {
  if (location.branchId) {
    return location.branchId;
  }
  if (location.type === 'community' && location.communityId) {
    return `community_${location.communityId}`;
  }
  return `area_${location.serviceAreaId ?? 'unknown'}`;
}

export function planVisitSlots(input: {
  projections: VisitProjection[];
  date: string;
  serviceId: string;
  communityId?: string;
  serviceAreaId?: string;
  branchId?: string;
}): PlannedSlot[] {
  const planned: PlannedSlot[] = [];
  const previous = addCivilDays(input.date, -1);
  for (const projection of input.projections) {
    if (projection.status !== 'active') {
      continue;
    }
    if (!matchesLocation(projection, input)) {
      continue;
    }
    const service = projection.services.find((item) => item.serviceId === input.serviceId);
    if (!service) {
      continue;
    }
    for (const window of projection.windows) {
      const sameDay = window.daysOfWeek.includes(weekdayOfCivilDate(input.date) as DayOfWeek)
        && covers(projection, input.date);
      const overnightTail = window.endDayOffset === 1
        && window.daysOfWeek.includes(weekdayOfCivilDate(previous) as DayOfWeek)
        && covers(projection, previous);
      if (sameDay) {
        planned.push(...slotsForOccurrence(projection, window, service, input.date, 0));
      }
      if (overnightTail) {
        planned.push(...slotsForOccurrence(projection, window, service, previous, 1));
      }
    }
  }
  return planned.sort((left, right) => left.clockStart.localeCompare(right.clockStart) || left.slotId.localeCompare(right.slotId));
}

export function sharedStep(durations: number[]): number {
  return durations.reduce((current, duration) => gcd(current, duration));
}

function slotsForOccurrence(
  projection: VisitProjection,
  window: VisitProjection['windows'][number],
  service: VisitProjection['services'][number],
  occurrenceDate: string,
  onlyOffset: 0 | 1,
): PlannedSlot[] {
  const buffer = window.bufferMinutes ?? 0;
  const occupancy = service.durationMinutes + buffer;
  const windowStart = minutes(window.startTime);
  const windowEnd = minutes(window.endTime) + window.endDayOffset * 1440;
  if (occupancy > windowEnd - windowStart) {
    return [];
  }
  const capacity = bookingCapacity(window, service);
  if (capacity === null || capacity < 1) {
    return [];
  }
  const fitting = projection.services
    .filter((item) => {
      const itemCapacity = bookingCapacity(window, item);
      return itemCapacity !== null && itemCapacity >= 1;
    })
    .map((item) => item.durationMinutes + buffer)
    .filter((length) => length <= windowEnd - windowStart);
  const step = sharedStep(fitting.length ? fitting : [occupancy]);
  if (occupancy % step !== 0 || occupancy / step > 23) {
    return [];
  }
  const water = waterLimit(window, service);
  const slots: PlannedSlot[] = [];
  for (let cursor = windowStart; cursor + occupancy <= windowEnd; cursor += step) {
    const startOffset = Math.floor(cursor / 1440) as 0 | 1;
    if (startOffset !== onlyOffset) {
      continue;
    }
    const civilDate = addCivilDays(occurrenceDate, startOffset);
    const clockStart = format(cursor % 1440);
    const endAbsolute = cursor + service.durationMinutes;
    const clockEnd = format(endAbsolute % 1440);
    const endDayOffset = (Math.floor(endAbsolute / 1440) > startOffset ? 1 : 0) as 0 | 1;
    const blocks = blocksFor(projection, window.windowId, occurrenceDate, cursor, occupancy, step, capacity);
    slots.push({
      slotId: atomicSlotId(blocks[0]),
      visitId: projection.visitId,
      windowId: window.windowId,
      branchId: branchKey(projection.location),
      timezone: projection.timezone,
      date: civilDate,
      occurrenceDate,
      clockStart,
      clockEnd,
      startDayOffset: startOffset,
      endDayOffset,
      durationMinutes: service.durationMinutes,
      occupancyMinutes: occupancy,
      capacity,
      ...(water ? { waterCapacityLiters: water.capacityLiters, waterLitersPerBooking: water.liters } : {}),
      blocks,
    });
  }
  return slots;
}

function blocksFor(
  projection: VisitProjection,
  windowId: string,
  occurrenceDate: string,
  cursor: number,
  occupancy: number,
  step: number,
  capacity: number,
): AtomicBlock[] {
  const blocks: AtomicBlock[] = [];
  for (let at = cursor; at < cursor + occupancy; at += step) {
    const length = Math.min(step, cursor + occupancy - at);
    const offset = Math.floor(at / 1440);
    const clock = at % 1440;
    const endAbsolute = at + length;
    const endOffset = Math.floor((endAbsolute - 1) / 1440);
    blocks.push({
      vendorId: projection.vendorId,
      branchId: branchKey(projection.location),
      visitId: projection.visitId,
      windowId,
      date: addCivilDays(occurrenceDate, offset),
      startTime: format(clock),
      endTime: format(endAbsolute % 1440),
      durationMinutes: length,
      startDayOffset: offset,
      endDayOffset: endOffset > offset ? 1 : 0,
      capacity,
      serviceIds: projection.serviceIds,
      timezone: projection.timezone,
    });
  }
  return blocks;
}

/**
 * Concurrent booking capacity. A saved maxConcurrentBookings value is kept.
 * Staff count is the crew size and is not copied into this number.
 * Returns null when water or equipment makes the service impossible in the window.
 */
export function bookingCapacity(
  window: VisitProjection['windows'][number],
  service: VisitProjection['services'][number],
): number | null {
  if (!resourcesAllow(window, service)) {
    return null;
  }
  if (typeof window.maxConcurrentBookings === 'number') {
    return window.maxConcurrentBookings;
  }
  const water = waterLimit(window, service);
  if (water) {
    return Math.min(100, Math.floor(water.capacityLiters / water.liters));
  }
  // Staff count is operational capacity, not a booking limit. Do not invent one.
  return null;
}

export function availableAfterReservations(input: {
  capacity: number;
  reserved: number;
  waterCapacityLiters?: number;
  waterLitersPerBooking?: number;
}): number {
  const byReservation = Math.max(input.capacity - input.reserved, 0);
  if (!input.waterCapacityLiters || !input.waterLitersPerBooking) {
    return byReservation;
  }
  const byWater = Math.max(
    Math.floor(input.waterCapacityLiters / input.waterLitersPerBooking) - input.reserved,
    0,
  );
  return Math.min(byReservation, byWater);
}

function resourcesAllow(
  window: VisitProjection['windows'][number],
  service: VisitProjection['services'][number],
): boolean {
  if (window.capacity && (!Number.isInteger(window.capacity.staffCount) || window.capacity.staffCount < 1)) {
    return false;
  }
  if (window.resources && !window.capacity) {
    return false;
  }
  if (!window.resources) {
    return true;
  }
  if (window.resources.equipment.providedByVendor !== true && service.requiresVendorEquipment !== false) {
    return false;
  }
  if (window.resources.water.source === 'waterless' && (service.requiresWater !== false || (service.waterLiters ?? 0) > 0)) {
    return false;
  }
  if (
    service.waterLiters !== undefined
    && window.resources.water.source === 'vendorSupplied'
    && (window.resources.water.capacityLiters ?? 0) < service.waterLiters
  ) {
    return false;
  }
  return true;
}

function waterLimit(
  window: VisitProjection['windows'][number],
  service: VisitProjection['services'][number],
): { capacityLiters: number; liters: number } | undefined {
  const water = window.resources?.water;
  if (
    water?.source === 'vendorSupplied'
    && water.capacityLiters
    && service.waterLiters
    && service.waterLiters > 0
  ) {
    return { capacityLiters: water.capacityLiters, liters: service.waterLiters };
  }
  return undefined;
}

function matchesLocation(
  projection: VisitProjection,
  input: { communityId?: string; serviceAreaId?: string; branchId?: string },
): boolean {
  if (input.branchId && branchKey(projection.location) !== input.branchId && projection.location.branchId !== input.branchId) {
    return false;
  }
  if (input.communityId) {
    return projection.location.type === 'community' && projection.location.communityId === input.communityId;
  }
  if (input.serviceAreaId) {
    return projection.location.type === 'serviceArea' && projection.location.serviceAreaId === input.serviceAreaId;
  }
  return true;
}

function covers(projection: VisitProjection, date: string): boolean {
  if (date < projection.effectiveFrom) {
    return false;
  }
  if (projection.effectiveUntil && date > projection.effectiveUntil) {
    return false;
  }
  return true;
}

export function atomicSlotId(block: AtomicBlock): string {
  const digest = createHash('sha256')
    .update(`${block.vendorId}|${block.branchId}|${block.date}|${block.startTime}|${block.visitId}|${block.windowId}|${block.durationMinutes}`)
    .digest('hex')
    .slice(0, 24);
  return `slot_${digest}`;
}

function minutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function format(total: number): string {
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
}
