import { createChildLogger, createLogger } from '@api-hub/observability';
import { ValidationError } from '@api-hub/utils';

import { STORED_SLOT_STATUS, ENTITY_TYPE } from '../domain/constants';
import { remainingCapacity } from '../domain/capacity';
import { atomicSlotId, availableAfterReservations, planVisitSlots, PlannedSlot, branchKey } from '../domain/service-visit-slots';
import { selectCapacityBlocks } from '../domain/slot-coverage';
import { addCivilDays, isSlotStartInPast, isValidDate } from '../domain/time';
import { zonedInstant } from '../domain/community-visits';
import { zonedClock } from '../domain/time';
import { HolidaysRepository, getHolidaysRepository } from '../repositories/holidays.repository';
import { SlotsRepository, getSlotsRepository } from '../repositories/slots.repository';
import { VisitProjectionRepository, getVisitProjectionRepository } from '../repositories/visit-projections.repository';
import { VisitProjection } from '../domain/visit-projection';
import { SlotItem, SlotLookupItem } from '../types/records';
import { AvailabilityKeyBuilder } from '../domain/keys';

const logger = createChildLogger(
  createLogger({ service: 'availability-service', redactPII: true }),
  { component: 'VisitSlots' },
);

export interface VisitSlotView {
  slotId: string;
  visitId: string;
  windowId: string;
  branchId: string;
  startTime: string;
  endTime: string;
  clockStart: string;
  clockEnd: string;
  capacity: number;
  reserved: number;
  available: number;
  status: 'available' | 'full' | 'blocked';
  durationMinutes: number;
}

export class VisitSlotsService {
  constructor(
    private readonly projections: VisitProjectionRepository = getVisitProjectionRepository(),
    private readonly slots: SlotsRepository = getSlotsRepository(),
    private readonly holidays: HolidaysRepository = getHolidaysRepository(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(input: {
    vendorId: string;
    communityId?: string;
    serviceAreaId?: string;
    serviceId: string;
    date: string;
    branchId?: string;
  }) {
    if (!isValidDate(input.date)) {
      throw new ValidationError('date must be YYYY-MM-DD');
    }
    if (!input.serviceId) {
      throw new ValidationError('serviceId is required');
    }
    const started = Date.now();
    const projections = await this.projections.list(input.vendorId);
    const planned = planVisitSlots({ projections, ...input });
    const holidayDates = await this.closedDates(input.vendorId, planned);
    const visible = planned.filter((slot) => !slot.blocks.some((block) => holidayDates.has(block.date)));
    for (const slot of visible) {
      if (!isSlotStartInPast(slot.date, slot.clockStart, slot.timezone, this.now())) {
        await this.ensure(slot);
      }
    }
    const stored = await this.loadBlocks(visible);
    const slots = visible
      .filter((slot) => !isSlotStartInPast(slot.date, slot.clockStart, slot.timezone, this.now()))
      .map((slot) => this.toView(slot, stored));
    logger.info({
      event: 'visit_slots_listed',
      vendorId: input.vendorId,
      communityId: input.communityId,
      serviceId: input.serviceId,
      date: input.date,
      count: slots.length,
      durationMs: Date.now() - started,
    });
    const timezone = visible[0]?.timezone ?? projections.find((item) => item.status === 'active')?.timezone ?? 'UTC';
    return {
      vendorId: input.vendorId,
      ...(input.communityId ? { communityId: input.communityId } : {}),
      ...(input.serviceAreaId ? { serviceAreaId: input.serviceAreaId } : {}),
      serviceId: input.serviceId,
      date: input.date,
      timezone,
      slots,
      items: slots,
    };
  }

  /**
   * Materialize the shared capacity blocks for one visit start and return them
   * for the existing atomic reservation transaction. No matching ACTIVE visit
   * is a rejection; booking cannot fall back to a legacy working-hours slot.
   */
  async prepareReservation(input: {
    vendorId: string;
    branchId: string;
    offeringId: string;
    date: string;
    startTime: string;
    timezone: string;
    durationMinutes: number;
    communityId?: string;
  }): Promise<{ ok: false; reason: string } | { ok: true; slots: SlotItem[]; visitId: string; windowId: string; occupancyMinutes: number }> {
    const projections = await this.projections.list(input.vendorId);
    const relevant = projections.filter((projection) =>
      projection.services.some((service) => service.serviceId === input.offeringId)
      && branchKey(projection.location) === input.branchId
      && projection.status === 'active'
      && (!input.communityId || projection.location.communityId === input.communityId),
    );
    if (relevant.length === 0) return { ok: false, reason: 'outside_visit' };
    const adjusted = relevant.map((projection) => ({
      ...projection,
      services: projection.services.map((service) => service.serviceId === input.offeringId
        ? { ...service, durationMinutes: input.durationMinutes }
        : service),
    }));
    const planned = planVisitSlots({
      projections: adjusted,
      date: input.date,
      serviceId: input.offeringId,
      branchId: input.branchId,
      communityId: input.communityId ?? communityOf(relevant, input.branchId),
      serviceAreaId: areaOf(relevant, input.branchId),
    });
    const match = planned.find((slot) => slot.date === input.date && slot.clockStart === input.startTime);
    if (!match || match.timezone !== input.timezone) {
      logger.info({
        event: 'visit_slot_rejected',
        vendorId: input.vendorId,
        branchId: input.branchId,
        serviceId: input.offeringId,
        date: input.date,
        startTime: input.startTime,
        reason: match ? 'timezone' : 'outside_visit',
      });
      return { ok: false, reason: match ? 'timezone' : 'outside_visit' };
    }
    if (input.durationMinutes !== match.durationMinutes) {
      return { ok: false, reason: 'duration' };
    }
    const holidayDates = await this.closedDates(input.vendorId, [match]);
    if (match.blocks.some((block) => holidayDates.has(block.date))) {
      return { ok: false, reason: 'holiday' };
    }
    await this.ensure(match);
    const stored = await this.loadBlocks([match]);
    const blocks = match.blocks.map((block) => stored.get(atomicSlotId(block))).filter((slot): slot is SlotItem => Boolean(slot));
    const selection = selectCapacityBlocks(blocks, {
      vendorId: input.vendorId,
      branchId: input.branchId,
      startTime: input.startTime,
      startDayOffset: match.startDayOffset,
      durationMinutes: match.occupancyMinutes,
      offeringId: input.offeringId,
      timezone: input.timezone,
    });
    if (!selection.ok) {
      return { ok: false, reason: selection.reason };
    }
    return {
      ok: true,
      slots: selection.slots as SlotItem[],
      visitId: match.visitId,
      windowId: match.windowId,
      occupancyMinutes: match.occupancyMinutes,
    };
  }

  private async ensure(slot: PlannedSlot): Promise<void> {
    const now = this.now().toISOString();
    for (const block of slot.blocks) {
      const slotId = atomicSlotId(block);
      const pk = AvailabilityKeyBuilder.dailyPk(block.vendorId, block.branchId, block.date);
      const sk = AvailabilityKeyBuilder.slotSk(block.startTime, slotId);
      const item: SlotItem = {
        PK: pk,
        SK: sk,
        entityType: ENTITY_TYPE.SLOT,
        slotId,
        vendorId: block.vendorId,
        branchId: block.branchId,
        date: block.date,
        startTime: block.startTime,
        endTime: block.endTime,
        timezone: block.timezone,
        durationMinutes: block.durationMinutes,
        capacity: block.capacity,
        heldCount: 0,
        bookedCount: 0,
        availableCount: block.capacity,
        status: STORED_SLOT_STATUS.AVAILABLE,
        serviceIds: block.serviceIds,
        vehicleTypeIds: [],
        visitId: block.visitId,
        windowId: block.windowId,
        startDayOffset: block.startDayOffset,
        endDayOffset: block.endDayOffset,
        createdAt: now,
        updatedAt: now,
      };
      const lookup: SlotLookupItem = {
        PK: AvailabilityKeyBuilder.slotLookupPk(slotId),
        SK: 'META',
        entityType: ENTITY_TYPE.SLOT_LOOKUP,
        slotId,
        vendorId: block.vendorId,
        branchId: block.branchId,
        date: block.date,
        canonicalPk: pk,
        canonicalSk: sk,
        createdAt: now,
      };
      await this.slots.createSlotIfAbsent(item, lookup);
    }
  }

  private async loadBlocks(slots: PlannedSlot[]): Promise<Map<string, SlotItem>> {
    const found = new Map<string, SlotItem>();
    const dates = new Set<string>();
    for (const slot of slots) {
      for (const block of slot.blocks) {
        dates.add(`${block.vendorId}|${block.branchId}|${block.date}`);
      }
    }
    for (const key of dates) {
      const [vendorId, branchId, date] = key.split('|');
      const day = await this.slots.querySlots({ vendorId, branchId, date });
      for (const item of day) {
        found.set(item.slotId, item);
      }
    }
    return found;
  }

  private toView(slot: PlannedSlot, stored: Map<string, SlotItem>): VisitSlotView {
    const blocks = slot.blocks.map((block) => stored.get(atomicSlotId(block))).filter((item): item is SlotItem => Boolean(item));
    const blocked = blocks.some((block) => block.status === 'blocked');
    const reserved = blocks.length
      ? Math.max(...blocks.map((block) => block.bookedCount + block.heldCount))
      : 0;
    const remaining = blocks.length
      ? Math.min(...blocks.map((block) => remainingCapacity(block)))
      : slot.capacity;
    const available = Math.min(
      remaining,
      availableAfterReservations({
        capacity: slot.capacity,
        reserved,
        waterCapacityLiters: slot.waterCapacityLiters,
        waterLitersPerBooking: slot.waterLitersPerBooking,
      }),
    );
    const endDate = slot.endDayOffset ? addCivilDays(slot.date, 1) : slot.date;
    const start = zonedIso(slot.date, slot.clockStart, slot.timezone);
    const end = zonedIso(endDate, slot.clockEnd, slot.timezone);
    return {
      slotId: slot.slotId,
      visitId: slot.visitId,
      windowId: slot.windowId,
      branchId: slot.branchId,
      startTime: start,
      endTime: end,
      clockStart: slot.clockStart,
      clockEnd: slot.clockEnd,
      capacity: slot.capacity,
      reserved,
      available: blocked ? 0 : available,
      status: blocked ? 'blocked' : available > 0 ? 'available' : 'full',
      durationMinutes: slot.durationMinutes,
    };
  }

  private async closedDates(vendorId: string, slots: PlannedSlot[]): Promise<Set<string>> {
    const branchIds = [...new Set(slots.map((slot) => slot.branchId))];
    const dates = new Set(slots.flatMap((slot) => slot.blocks.map((block) => block.date)));
    const closed = new Set<string>();
    const vendorHolidays = await this.holidays.listVendorHolidays(vendorId);
    for (const holiday of vendorHolidays) {
      if (dates.has(holiday.date)) {
        closed.add(holiday.date);
      }
    }
    for (const branchId of branchIds) {
      const branchHolidays = await this.holidays.listBranchHolidays(vendorId, branchId);
      for (const holiday of branchHolidays) {
        if (dates.has(holiday.date)) {
          closed.add(holiday.date);
        }
      }
    }
    return closed;
  }
}

function zonedIso(date: string, time: string, timeZone: string): string {
  const instant = zonedInstant(date, time, timeZone);
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const read = (type: string) => formatted.find((part) => part.type === type)?.value ?? '';
  const zone = read('timeZoneName').replace('GMT', '').replace('UTC', '');
  const offset = zone === '' ? 'Z' : zone;
  const clock = zonedClock(timeZone, instant);
  return `${clock.date}T${clock.time}:00${offset}`;
}

function communityOf(projections: VisitProjection[], branchId: string): string | undefined {
  return projections.find((item) => branchKey(item.location) === branchId)?.location.communityId;
}

function areaOf(projections: VisitProjection[], branchId: string): string | undefined {
  return projections.find((item) => branchKey(item.location) === branchId)?.location.serviceAreaId;
}

let service: VisitSlotsService | undefined;

export function getVisitSlotsService(): VisitSlotsService {
  if (!service) {
    service = new VisitSlotsService();
  }
  return service;
}
