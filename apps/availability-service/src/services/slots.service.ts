import { ConditionalWriteConflictError, LambdaRequest, ValidationError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import {
  assertCanManageSchedule,
  getAuthenticatedUserId,
  isScheduleManager,
} from '../auth/access';
import { ENTITY_TYPE, STORED_SLOT_STATUS } from '../domain/constants';
import { hasBookableCapacity } from '../domain/capacity';
import { parseBookableOfferingsQuery } from '../domain/bookable-offerings';
import { deterministicSlotId } from '../domain/ids';
import { AvailabilityKeyBuilder } from '../domain/keys';
import { selectCapacityBlocks, supportsService, supportsVehicle } from '../domain/slot-coverage';
import {
  buildSlotWindows,
  isSlotStartInPast,
  isValidTime,
  weekdayOfCivilDate,
} from '../domain/time';
import { toSlotView } from '../domain/view';
import { AvailabilityErrors } from '../errors';
import {
  AvailabilityRepository,
  getAvailabilityRepository,
} from '../repositories/availability.repository';
import {
  HolidaysRepository,
  getHolidaysRepository,
} from '../repositories/holidays.repository';
import { getSlotsRepository, SlotsRepository } from '../repositories/slots.repository';
import { SlotItem, SlotLookupItem, SlotView, WorkingHoursItem } from '../types/records';
import {
  decodeCursor,
  encodeCursor,
  parseBoolean,
  parseDateRange,
  parseLimit,
  pathParam,
  queryValue,
} from '../utils/request';

const baseLogger = createLogger({
  service: 'slots-service',
  redactPII: true,
});

interface GenerateBody {
  branchId?: string;
  date?: string;
  fromDate?: string;
  toDate?: string;
  slotDurationMinutes?: number;
  capacity?: number;
  serviceIds?: string[];
  vehicleTypeIds?: string[];
}

export class SlotsService {
  private readonly logger = createChildLogger(baseLogger, { service: 'SlotsService' });

  constructor(
    private readonly slots: SlotsRepository = getSlotsRepository(),
    private readonly schedules: AvailabilityRepository = getAvailabilityRepository(),
    private readonly holidays: HolidaysRepository = getHolidaysRepository(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getslots(request: LambdaRequest): Promise<{
    items: SlotView[];
    nextCursor?: string;
  }> {
    getAuthenticatedUserId(request);
    const vendorId = pathParam(request, 'vendorId');
    const branchId = requiredBranch(request);
    const range = parseDateRange(request);
    const schedule = await this.schedules.getWorkingHours(vendorId, branchId);
    const manager = isScheduleManager(request, schedule);
    const bookable = parseBoolean(queryValue(request, 'bookable')) ?? !manager;
    const fromTime = queryValue(request, 'fromTime');
    const toTime = queryValue(request, 'toTime');
    if ((fromTime && !isValidTime(fromTime)) || (toTime && !isValidTime(toTime))) {
      throw new ValidationError('fromTime and toTime must be HH:mm');
    }
    const serviceId = queryValue(request, 'serviceId');
    const vehicleTypeId = queryValue(request, 'vehicleTypeId');
    const serviceDuration = optionalPositiveInt(
      queryValue(request, 'serviceDurationMinutes'),
      'serviceDurationMinutes',
    );
    const limit = parseLimit(queryValue(request, 'limit'));
    const cursor = decodeCursor(queryValue(request, 'cursor'));

    const holidayDates = await this.closedDates(vendorId, branchId, range.dates);
    const widenForDuration = bookable && serviceDuration !== undefined;
    const collected: SlotItem[] = [];
    await mapPool(range.dates, 8, async (date) => {
      const daySlots = await this.slots.querySlots({
        vendorId,
        branchId,
        date,
        fromTime: widenForDuration ? undefined : fromTime,
        toTime: widenForDuration ? undefined : toTime,
      });
      collected.push(...daySlots);
    });
    collected.sort(byStart);

    const filtered = collected.filter((slot) => {
      if (fromTime && slot.startTime < fromTime) {
        return false;
      }
      if (toTime && slot.startTime > toTime) {
        return false;
      }
      if (cursor && (slot.date < cursor.date || (slot.date === cursor.date && slot.startTime <= cursor.startTime))) {
        return false;
      }
      if (!bookable) {
        return true;
      }
      const peers = collected.filter(
        (peer) => peer.date === slot.date && peer.vendorId === slot.vendorId && peer.branchId === slot.branchId,
      );
      return this.isBookable(slot, peers, schedule, holidayDates, {
        serviceId,
        vehicleTypeId,
        serviceDuration,
      });
    });

    const page = filtered.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      filtered.length > limit && last ? encodeCursor(last.date, last.startTime) : undefined;

    this.logger.info({
      event: 'slots_listed',
      vendorId,
      branchId,
      count: page.length,
      bookable,
    });

    return {
      items: page.map(toSlotView),
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  /**
   * Internal marketplace check. One query per branch-day, then the same
   * bookable rules as the public slot list.
   */
  async findBookableOfferings(event: unknown): Promise<{ keys: string[] }> {
    const request = parseBookableOfferingsQuery(event);
    const groups = new Map<string, typeof request.offerings>();
    for (const offering of request.offerings) {
      const key = `${offering.vendorId}#${offering.branchId}`;
      const group = groups.get(key) ?? [];
      group.push(offering);
      groups.set(key, group);
    }

    const keys = new Set<string>();
    await mapPool([...groups.values()], 8, async (probes) => {
      const first = probes[0];
      const schedule = await this.schedules.getWorkingHours(first.vendorId, first.branchId);
      const holidayDates = await this.closedDates(first.vendorId, first.branchId, [request.date]);
      const slots = await this.slots.querySlots({
        vendorId: first.vendorId,
        branchId: first.branchId,
        date: request.date,
      });
      for (const probe of probes) {
        const bookable = probe.vehicles.some((vehicle) => slots.some((slot) => {
          if (request.startTime && slot.startTime !== request.startTime) {
            return false;
          }
          return this.isBookable(slot, slots, schedule, holidayDates, {
            serviceId: probe.offeringId,
            vehicleTypeId: vehicle.vehicleType,
            serviceDuration: vehicle.durationMinutes,
          });
        }));
        if (bookable) {
          keys.add(`${probe.vendorId}#${probe.branchId}#${probe.offeringId}`);
        }
      }
    });

    this.logger.info({
      event: 'bookable_offerings_checked',
      date: request.date,
      branchCount: groups.size,
      offeringCount: request.offerings.length,
      bookableCount: keys.size,
    });

    return { keys: [...keys] };
  }

  async postslots(request: LambdaRequest): Promise<{
    items: SlotView[];
    createdCount: number;
    existingCount: number;
  }> {
    const vendorId = pathParam(request, 'vendorId');
    const body = (request.body ?? {}) as GenerateBody;
    const branchId = body.branchId?.trim();
    if (!branchId) {
      throw new ValidationError('branchId is required');
    }
    pathSafe(branchId, 'branchId');
    const schedule = await this.schedules.getWorkingHours(vendorId, branchId);
    assertCanManageSchedule(request, schedule);
    if (!schedule) {
      throw AvailabilityErrors.vendorNotAvailable(
        'Working hours are not configured for this branch',
      );
    }
    const duration = body.slotDurationMinutes;
    const capacity = body.capacity;
    if (!duration || !Number.isInteger(duration) || duration < 15 || duration > 240) {
      throw new ValidationError('slotDurationMinutes must be an integer between 15 and 240');
    }
    if (!capacity || !Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
      throw new ValidationError('capacity must be an integer between 1 and 100');
    }
    const serviceIds = stringList(body.serviceIds, 'serviceIds');
    const vehicleTypeIds = stringList(body.vehicleTypeIds, 'vehicleTypeIds');
    const range = rangeFromBody(body);
    const holidayDates = await this.closedDates(vendorId, branchId, range.dates);
    const openDates = range.dates.filter((date) => !holidayDates.has(date) && openWindow(schedule, date));
    if (openDates.length === 0) {
      throw AvailabilityErrors.vendorNotAvailable(
        'No open working days in the requested range',
      );
    }

    let createdCount = 0;
    let existingCount = 0;
    const items: SlotItem[] = [];
    for (const date of openDates) {
      const window = openWindow(schedule, date);
      if (!window) {
        continue;
      }
      const slots = buildSlotWindows(window.openTime, window.closeTime, duration);
      for (const slotWindow of slots) {
        const slot = this.buildSlot(schedule, date, slotWindow, {
          duration,
          capacity,
          serviceIds,
          vehicleTypeIds,
        });
        const outcome = await this.slots.createSlotIfAbsent(slot.item, slot.lookup);
        if (outcome === 'created') {
          createdCount += 1;
          items.push(slot.item);
        } else {
          existingCount += 1;
          const current = await this.slots.getCanonicalSlot(slot.item.PK, slot.item.SK);
          if (current) {
            items.push(current);
          }
        }
      }
    }

    this.logger.info({
      event: 'slots_generated',
      vendorId,
      branchId,
      createdCount,
      existingCount,
    });

    return {
      items: items.sort(byStart).map(toSlotView),
      createdCount,
      existingCount,
    };
  }

  async getslotid(request: LambdaRequest): Promise<SlotView> {
    getAuthenticatedUserId(request);
    const slot = await this.requireSlot(pathParam(request, 'slotId'));
    return toSlotView(slot);
  }

  async postblock(request: LambdaRequest): Promise<SlotView> {
    return this.changeBlock(request, true);
  }

  async postunblock(request: LambdaRequest): Promise<SlotView> {
    return this.changeBlock(request, false);
  }

  private async changeBlock(request: LambdaRequest, blocked: boolean): Promise<SlotView> {
    const slot = await this.requireSlot(pathParam(request, 'slotId'));
    const schedule = await this.schedules.getWorkingHours(slot.vendorId, slot.branchId);
    assertCanManageSchedule(request, schedule);
    if (!schedule || schedule.ownerUserId !== getAuthenticatedUserId(request)) {
      if (!isScheduleManager(request, schedule)) {
        throw AvailabilityErrors.vendorNotAvailable('Working hours are not configured for this branch');
      }
    }
    const target = blocked ? STORED_SLOT_STATUS.BLOCKED : STORED_SLOT_STATUS.AVAILABLE;
    if (slot.status === target) {
      return toSlotView(slot);
    }
    try {
      await this.slots.setBlocked(slot, blocked, this.now().toISOString());
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) {
        throw error;
      }
      const current = await this.requireSlot(slot.slotId);
      if (current.status === target) {
        return toSlotView(current);
      }
      throw AvailabilityErrors.slotUnavailable('Slot status changed concurrently');
    }
    const updated = await this.requireSlot(slot.slotId);
    this.logger.info({
      event: blocked ? 'slot_blocked' : 'slot_unblocked',
      slotId: slot.slotId,
      vendorId: slot.vendorId,
    });
    return toSlotView(updated);
  }

  private isBookable(
    slot: SlotItem,
    peers: SlotItem[],
    schedule: WorkingHoursItem | null,
    holidayDates: Set<string>,
    filter: {
      serviceId?: string;
      vehicleTypeId?: string;
      serviceDuration?: number;
    },
  ): boolean {
    if (!schedule || holidayDates.has(slot.date) || !openWindow(schedule, slot.date)) {
      return false;
    }
    if (!hasBookableCapacity(slot, 1)) {
      return false;
    }
    if (isSlotStartInPast(slot.date, slot.startTime, slot.timezone, this.now())) {
      return false;
    }
    const window = openWindow(schedule, slot.date);
    if (!window || slot.startTime < window.openTime || slot.endTime > window.closeTime) {
      return false;
    }
    if (!supportsService(slot.serviceIds, filter.serviceId)) {
      return false;
    }
    if (!supportsVehicle(slot.vehicleTypeIds, filter.vehicleTypeId)) {
      return false;
    }
    if (!filter.serviceDuration) {
      return true;
    }
    const cover = selectCapacityBlocks(peers, {
      vendorId: slot.vendorId,
      branchId: slot.branchId,
      date: slot.date,
      startTime: slot.startTime,
      durationMinutes: filter.serviceDuration,
      offeringId: filter.serviceId,
      vehicleType: filter.vehicleTypeId,
      timezone: slot.timezone,
    });
    return cover.ok && cover.slots.some((selected) => selected.slotId === slot.slotId);
  }

  private buildSlot(
    schedule: WorkingHoursItem,
    date: string,
    window: { startTime: string; endTime: string },
    input: {
      duration: number;
      capacity: number;
      serviceIds: string[];
      vehicleTypeIds: string[];
    },
  ): { item: SlotItem; lookup: SlotLookupItem } {
    const now = this.now().toISOString();
    const slotId = deterministicSlotId(
      schedule.vendorId,
      schedule.branchId,
      date,
      window.startTime,
    );
    const pk = AvailabilityKeyBuilder.dailyPk(schedule.vendorId, schedule.branchId, date);
    const sk = AvailabilityKeyBuilder.slotSk(window.startTime, slotId);
    return {
      item: {
        PK: pk,
        SK: sk,
        entityType: ENTITY_TYPE.SLOT,
        slotId,
        vendorId: schedule.vendorId,
        branchId: schedule.branchId,
        date,
        startTime: window.startTime,
        endTime: window.endTime,
        timezone: schedule.timezone,
        durationMinutes: input.duration,
        capacity: input.capacity,
        heldCount: 0,
        bookedCount: 0,
        availableCount: input.capacity,
        status: STORED_SLOT_STATUS.AVAILABLE,
        serviceIds: input.serviceIds,
        vehicleTypeIds: input.vehicleTypeIds,
        createdAt: now,
        updatedAt: now,
      },
      lookup: {
        PK: AvailabilityKeyBuilder.slotLookupPk(slotId),
        SK: 'META',
        entityType: ENTITY_TYPE.SLOT_LOOKUP,
        slotId,
        vendorId: schedule.vendorId,
        branchId: schedule.branchId,
        date,
        canonicalPk: pk,
        canonicalSk: sk,
        createdAt: now,
      },
    };
  }

  private async closedDates(
    vendorId: string,
    branchId: string,
    dates: string[],
  ): Promise<Set<string>> {
    const [branchHolidays, vendorHolidays] = await Promise.all([
      this.holidays.listBranchHolidays(vendorId, branchId),
      this.holidays.listVendorHolidays(vendorId),
    ]);
    const wanted = new Set(dates);
    const closed = new Set<string>();
    for (const holiday of [...branchHolidays, ...vendorHolidays]) {
      if (wanted.has(holiday.date)) {
        closed.add(holiday.date);
      }
    }
    return closed;
  }

  private async requireSlot(slotId: string): Promise<SlotItem> {
    const lookup = await this.slots.getSlotLookup(slotId);
    if (!lookup) {
      throw AvailabilityErrors.slotNotFound();
    }
    const slot = await this.slots.getCanonicalSlot(lookup.canonicalPk, lookup.canonicalSk);
    if (!slot) {
      throw AvailabilityErrors.slotNotFound();
    }
    return slot;
  }
}

function openWindow(
  schedule: WorkingHoursItem,
  date: string,
): { openTime: string; closeTime: string } | null {
  const day = schedule.hours.find((entry) => entry.dayOfWeek === weekdayOfCivilDate(date));
  if (!day || day.closed || !day.openTime || !day.closeTime) {
    return null;
  }
  return { openTime: day.openTime, closeTime: day.closeTime };
}

function byStart(left: SlotItem, right: SlotItem): number {
  return left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime);
}

function requiredBranch(request: LambdaRequest): string {
  const branchId = queryValue(request, 'branchId');
  if (!branchId) {
    throw new ValidationError('branchId is required');
  }
  pathSafe(branchId, 'branchId');
  return branchId;
}

function pathSafe(value: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(value)) {
    throw new ValidationError(`${name} is invalid`);
  }
}

function stringList(value: unknown, name: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new ValidationError(`${name} must be an array of strings`);
  }
  return value.map((entry) => entry.trim());
}

function optionalPositiveInt(raw: string | undefined, name: string): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError(`${name} must be a positive integer`);
  }
  return value;
}

function rangeFromBody(body: GenerateBody) {
  const request = {
    params: {
      ...(body.date ? { date: body.date } : {}),
      ...(body.fromDate ? { fromDate: body.fromDate } : {}),
      ...(body.toDate ? { toDate: body.toDate } : {}),
    },
    event: { queryStringParameters: null },
  } as LambdaRequest;
  return parseDateRange(request);
}

async function mapPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current]);
    }
  });
  await Promise.all(runners);
}

let service: SlotsService;

export function getSlotsService(): SlotsService {
  if (!service) {
    service = new SlotsService();
  }
  return service;
}
