import { ConditionalWriteConflictError, NotFoundError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { requirePathId } from '../auth/access';
import { toAllocationSummary } from '../domain/view';
import { AvailabilityErrors } from '../errors';
import {
  AllocationsRepository,
  getAllocationsRepository,
} from '../repositories/allocations.repository';
import { getSlotsRepository, SlotsRepository } from '../repositories/slots.repository';
import { HoldsService, getHoldsService } from './holds.service';
import { getAvailabilityRepository, AvailabilityRepository } from '../repositories/availability.repository';
import { getHolidaysRepository, HolidaysRepository } from '../repositories/holidays.repository';
import { AvailabilityKeyBuilder } from '../domain/keys';
import {
  RESERVATION_REJECTION,
  ReservationRejection,
  selectCapacityBlocks,
  slotQueryBounds,
} from '../domain/slot-coverage';
import { addMinutes, isSlotStartInPast, isValidTime, weekdayOfCivilDate } from '../domain/time';
import { AllocationItem, AllocationLookupItem, CoveredSlotRef, SlotItem } from '../types/records';

const baseLogger = createLogger({
  service: 'allocations-service',
  redactPII: true,
});

export class AllocationsService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'AllocationsService',
  });

  constructor(
    private readonly allocations: AllocationsRepository = getAllocationsRepository(),
    private readonly slots: SlotsRepository = getSlotsRepository(),
    private readonly holds: HoldsService = getHoldsService(),
    private readonly now: () => Date = () => new Date(),
    private readonly schedules: AvailabilityRepository = getAvailabilityRepository(),
    private readonly holidays: HolidaysRepository = getHolidaysRepository(),
  ) {}

  async consumeHold(input: { holdId?: string; bookingId?: string }) {
    if (!input.holdId || !input.bookingId) {
      throw new NotFoundError('holdId and bookingId are required');
    }
    return this.holds.consume({
      holdId: input.holdId,
      bookingId: input.bookingId,
    });
  }

  async releaseByBooking(input: { bookingId?: string }) {
    const bookingId = requirePathId(input.bookingId ?? '', 'bookingId');
    const lookup = await this.allocations.getByBookingId(bookingId);
    if (!lookup) {
      throw new NotFoundError('Allocation not found');
    }
    if (lookup.status === 'released') {
      return toAllocationSummary(lookup);
    }
    const allocation = await this.allocations.getCanonical(
      lookup.canonicalPk,
      lookup.canonicalSk,
    );
    if (!allocation) {
      throw new NotFoundError('Allocation not found');
    }
    const slots = await this.slotsForAllocation(allocation, lookup);
    try {
      await this.allocations.releaseAllocation({
        allocation,
        lookup,
        slots,
        now: this.now().toISOString(),
      });
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) {
        throw error;
      }
      const current = await this.allocations.getByBookingId(bookingId);
      if (current?.status === 'released') {
        return toAllocationSummary(current);
      }
      throw error;
    }
    this.logger.info({
      event: 'allocation_released',
      bookingId,
      slotId: allocation.slotId,
      slotIds: allocation.slotIds ?? allocation.coveredSlots?.map((slot) => slot.slotId) ?? [allocation.slotId],
    });
    return toAllocationSummary({ ...allocation, status: 'released' });
  }

  async reserveBooking(input: {
    bookingId?: string;
    customerId?: string;
    vendorId?: string;
    branchId?: string;
    offeringId?: string;
    vehicleType?: string;
    date?: string;
    startTime?: string;
    timezone?: string;
    durationMinutes?: number;
  }) {
    const bookingId = requirePathId(input.bookingId ?? '', 'bookingId');
    const required = ['customerId', 'vendorId', 'branchId', 'offeringId', 'vehicleType', 'date', 'startTime', 'timezone'] as const;
    for (const key of required) {
      if (!input[key] || typeof input[key] !== 'string') {
        throw AvailabilityErrors.slotUnavailable(`${key} is required`);
      }
    }
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes! < 1) {
      throw AvailabilityErrors.slotUnavailable('durationMinutes is required');
    }
    const request = {
      bookingId,
      customerId: input.customerId!,
      vendorId: input.vendorId!,
      branchId: input.branchId!,
      offeringId: input.offeringId!,
      vehicleType: input.vehicleType!,
      date: input.date!,
      startTime: input.startTime!,
      timezone: input.timezone!,
      durationMinutes: input.durationMinutes!,
    };
    const existing = await this.allocations.getByBookingId(bookingId);
    if (existing) {
      if (existing.status === 'released') {
        throw AvailabilityErrors.slotUnavailable('Booking capacity reservation was released');
      }
      if (!(await this.matchesExisting(existing, request))) {
        throw AvailabilityErrors.slotUnavailable(
          'Existing booking reservation is unavailable for a different schedule',
        );
      }
      return this.viewFromExisting(existing, request.durationMinutes);
    }
    await this.assertRequestedInterval(request);
    const bounds = slotQueryBounds(request.startTime, request.durationMinutes);
    const candidates = (await this.slots.querySlotStarts({
      vendorId: request.vendorId,
      branchId: request.branchId,
      date: request.date,
      fromTime: bounds.fromTime,
      toTimeExclusive: bounds.toTimeExclusive,
    })).filter((candidate) => candidate.entityType === 'Slot');
    const selection = selectCapacityBlocks(candidates, request);
    this.logger.info({
      event: 'availability_slot_candidates_evaluated',
      bookingId: request.bookingId,
      vendorId: request.vendorId,
      branchId: request.branchId,
      date: request.date,
      startTime: request.startTime,
      requestedDurationMinutes: request.durationMinutes,
      candidateCount: candidates.length,
      queryFrom: bounds.fromTime,
      queryToExclusive: bounds.toTimeExclusive,
      ...(selection.ok
        ? { selectedSlotIds: selection.slots.map((slot) => slot.slotId) }
        : { rejectionReason: selection.reason }),
    });
    if (!selection.ok) {
      this.rejectSelection(selection.reason);
    }
    const now = this.now().toISOString();
    const reserved = this.reservationView(
      selection.anchor.slotId,
      request.date,
      request.startTime,
      request.timezone,
      request.durationMinutes,
    );
    const coveredSlots: CoveredSlotRef[] = selection.slots.map((slot) => ({
      slotId: slot.slotId,
      canonicalPk: slot.PK,
      canonicalSk: slot.SK,
    }));
    const slotIds = selection.slots.map((slot) => slot.slotId);
    const anchor = selection.anchor;
    const allocation: AllocationItem = {
      PK: anchor.PK,
      SK: AvailabilityKeyBuilder.allocationSk(anchor.slotId, bookingId),
      entityType: 'SlotAllocation',
      bookingId,
      slotId: anchor.slotId,
      slotIds,
      coveredSlots,
      vendorId: anchor.vendorId,
      branchId: anchor.branchId,
      customerId: request.customerId,
      offeringId: request.offeringId,
      vehicleType: request.vehicleType,
      date: request.date,
      startTime: request.startTime,
      endTime: reserved.endTime,
      timezone: request.timezone,
      durationMinutes: request.durationMinutes,
      units: 1,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    };
    const allocationLookup: AllocationLookupItem = {
      PK: AvailabilityKeyBuilder.allocationLookupPk(bookingId),
      SK: AvailabilityKeyBuilder.allocationLookupSk(),
      entityType: 'AllocationLookup',
      bookingId,
      slotId: anchor.slotId,
      slotIds,
      coveredSlots,
      vendorId: anchor.vendorId,
      branchId: anchor.branchId,
      customerId: request.customerId,
      offeringId: request.offeringId,
      vehicleType: request.vehicleType,
      date: request.date,
      startTime: request.startTime,
      endTime: reserved.endTime,
      timezone: request.timezone,
      durationMinutes: request.durationMinutes,
      units: 1,
      status: 'confirmed',
      canonicalPk: allocation.PK,
      canonicalSk: allocation.SK,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.allocations.reserveBooking({
        slots: selection.slots.map((slot) => ({
          PK: slot.PK,
          SK: slot.SK,
          capacity: slot.capacity,
          bookedCount: slot.bookedCount,
          heldCount: slot.heldCount,
        })),
        allocation,
        allocationLookup,
        now,
      });
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) {
        throw error;
      }
      const current = await this.allocations.getByBookingId(bookingId);
      if (current?.status === 'confirmed' && (await this.matchesExisting(current, request))) {
        this.logger.info({
          event: 'booking_capacity_reserved',
          bookingId,
          slotId: current.slotId,
          slotIds: current.slotIds ?? [current.slotId],
          idempotent: true,
        });
        return this.viewFromExisting(current, request.durationMinutes);
      }
      if (current?.status === 'confirmed') {
        throw AvailabilityErrors.slotUnavailable(
          'Existing booking reservation is unavailable for a different schedule',
        );
      }
      if (current?.status === 'released') {
        throw AvailabilityErrors.slotUnavailable('Booking capacity reservation was released');
      }
      this.logger.info({
        event: 'availability_slot_candidates_evaluated',
        bookingId,
        vendorId: request.vendorId,
        branchId: request.branchId,
        date: request.date,
        startTime: request.startTime,
        requestedDurationMinutes: request.durationMinutes,
        candidateCount: candidates.length,
        rejectionReason: RESERVATION_REJECTION.INSUFFICIENT_CAPACITY,
      });
      throw AvailabilityErrors.capacityExceeded();
    }
    this.logger.info({
      event: 'booking_capacity_reserved',
      bookingId,
      slotId: anchor.slotId,
      slotIds,
    });
    return reserved;
  }

  private async assertRequestedInterval(input: {
    bookingId: string;
    vendorId: string;
    branchId: string;
    date: string;
    startTime: string;
    timezone: string;
    durationMinutes: number;
  }): Promise<void> {
    const context = {
      bookingId: input.bookingId,
      vendorId: input.vendorId,
      branchId: input.branchId,
      date: input.date,
      startTime: input.startTime,
      requestedDurationMinutes: input.durationMinutes,
    };
    if (!isValidTime(input.startTime)) {
      this.logger.info({
        event: 'availability_slot_candidates_evaluated',
        ...context,
        candidateCount: 0,
        rejectionReason: RESERVATION_REJECTION.NO_SLOT_FOUND,
      });
      throw AvailabilityErrors.slotUnavailable('No compatible capacity exists at the selected time');
    }
    const endTime = addMinutes(input.startTime, input.durationMinutes);
    if (isSlotStartInPast(input.date, input.startTime, input.timezone, this.now())) {
      this.logger.info({
        event: 'availability_slot_candidates_evaluated',
        ...context,
        candidateCount: 0,
        rejectionReason: 'START_IN_PAST',
      });
      throw AvailabilityErrors.slotUnavailable('Selected time has passed');
    }
    const [schedule, branchHolidays, vendorHolidays] = await Promise.all([
      this.schedules.getWorkingHours(input.vendorId, input.branchId),
      this.holidays.listBranchHolidays(input.vendorId, input.branchId),
      this.holidays.listVendorHolidays(input.vendorId),
    ]);
    if (schedule && schedule.timezone !== input.timezone) {
      this.logger.info({
        event: 'availability_slot_candidates_evaluated',
        ...context,
        candidateCount: 0,
        rejectionReason: RESERVATION_REJECTION.TIMEZONE_MISMATCH,
      });
      throw AvailabilityErrors.slotUnavailable('Selected timezone does not match branch working hours');
    }
    const day = schedule?.hours.find((entry) => entry.dayOfWeek === weekdayOfCivilDate(input.date));
    const outsideHours = !schedule || !day || day.closed || !day.openTime || !day.closeTime
      || input.startTime < day.openTime
      || endTime > day.closeTime
      || branchHolidays.some((holiday) => holiday.date === input.date)
      || vendorHolidays.some((holiday) => holiday.date === input.date);
    if (outsideHours) {
      this.logger.info({
        event: 'availability_slot_candidates_evaluated',
        ...context,
        candidateCount: 0,
        rejectionReason: RESERVATION_REJECTION.OUTSIDE_WORKING_HOURS,
      });
      throw AvailabilityErrors.vendorNotAvailable('Branch is not available at the selected time');
    }
  }

  private rejectSelection(reason: ReservationRejection): never {
    switch (reason) {
      case RESERVATION_REJECTION.INSUFFICIENT_CAPACITY:
      case RESERVATION_REJECTION.OVERLAPPING_RESERVATION:
      case RESERVATION_REJECTION.SLOT_BLOCKED:
        throw AvailabilityErrors.capacityExceeded();
      case RESERVATION_REJECTION.OUTSIDE_WORKING_HOURS:
        throw AvailabilityErrors.vendorNotAvailable('Branch is not available at the selected time');
      case RESERVATION_REJECTION.TIMEZONE_MISMATCH:
        throw AvailabilityErrors.slotUnavailable('Selected timezone does not match branch working hours');
      default:
        throw AvailabilityErrors.slotUnavailable('No compatible capacity exists at the selected time');
    }
  }

  private async matchesExisting(
    existing: AllocationLookupItem,
    input: {
      customerId: string;
      vendorId: string;
      branchId: string;
      offeringId: string;
      vehicleType: string;
      date: string;
      startTime: string;
      timezone: string;
      durationMinutes: number;
    },
  ): Promise<boolean> {
    if (existing.vendorId !== input.vendorId || existing.branchId !== input.branchId) {
      return false;
    }
    if (existing.customerId !== input.customerId) {
      return false;
    }
    if (existing.offeringId && existing.offeringId !== input.offeringId) {
      return false;
    }
    if (
      existing.vehicleType &&
      existing.vehicleType.toLowerCase() !== input.vehicleType.toLowerCase()
    ) {
      return false;
    }
    if (existing.timezone && existing.timezone !== input.timezone) {
      return false;
    }
    if (existing.date && existing.startTime && typeof existing.durationMinutes === 'number') {
      return existing.date === input.date
        && existing.startTime === input.startTime
        && existing.durationMinutes === input.durationMinutes;
    }
    const slot = await this.requireSlot(existing.slotId);
    return slot.vendorId === input.vendorId
      && slot.branchId === input.branchId
      && slot.date === input.date
      && slot.startTime === input.startTime
      && input.durationMinutes <= slot.durationMinutes;
  }

  private async viewFromExisting(
    existing: AllocationLookupItem,
    requestedDuration: number,
  ) {
    if (
      existing.date &&
      existing.startTime &&
      existing.endTime &&
      existing.timezone &&
      typeof existing.durationMinutes === 'number'
    ) {
      return {
        slotId: existing.slotId,
        date: existing.date,
        startTime: existing.startTime,
        endTime: existing.endTime,
        timezone: existing.timezone,
        durationMinutes: existing.durationMinutes,
      };
    }
    const slot = await this.requireSlot(existing.slotId);
    return this.reservationView(
      slot.slotId,
      slot.date,
      slot.startTime,
      slot.timezone,
      existing.durationMinutes ?? requestedDuration,
    );
  }

  private async slotsForAllocation(
    allocation: AllocationItem,
    lookup: AllocationLookupItem,
  ): Promise<SlotItem[]> {
    const keys = await this.allocationSlotKeys(allocation, lookup);
    const loaded = await Promise.all(
      keys.map((key) => this.slots.getCanonicalSlot(key.PK, key.SK)),
    );
    const slots: SlotItem[] = [];
    for (const slot of loaded) {
      if (!slot) {
        throw AvailabilityErrors.slotNotFound();
      }
      slots.push(slot);
    }
    return slots;
  }

  private async allocationSlotKeys(
    allocation: AllocationItem,
    lookup: AllocationLookupItem,
  ): Promise<Array<{ PK: string; SK: string }>> {
    const covered = allocation.coveredSlots?.length ? allocation.coveredSlots : lookup.coveredSlots;
    if (covered && covered.length > 0) {
      const seen = new Set<string>();
      const keys: Array<{ PK: string; SK: string }> = [];
      for (const slot of covered) {
        const id = `${slot.canonicalPk}\u0000${slot.canonicalSk}`;
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        keys.push({ PK: slot.canonicalPk, SK: slot.canonicalSk });
      }
      return keys;
    }
    const slotLookup = await this.slots.getSlotLookup(allocation.slotId);
    if (!slotLookup) {
      throw AvailabilityErrors.slotNotFound();
    }
    return [{ PK: slotLookup.canonicalPk, SK: slotLookup.canonicalSk }];
  }

  private async requireSlot(slotId: string): Promise<SlotItem> {
    const lookup = await this.slots.getSlotLookup(slotId);
    const slot = lookup && await this.slots.getCanonicalSlot(lookup.canonicalPk, lookup.canonicalSk);
    if (!slot) throw AvailabilityErrors.slotNotFound();
    return slot;
  }

  private reservationView(
    slotId: string,
    date: string,
    startTime: string,
    timezone: string,
    durationMinutes: number,
  ) {
    return {
      slotId,
      date,
      startTime,
      endTime: addMinutes(startTime, durationMinutes),
      timezone,
      durationMinutes,
    };
  }

  async findByBooking(bookingId: string) {
    const lookup = await this.allocations.getByBookingId(requirePathId(bookingId, 'bookingId'));
    if (!lookup) {
      return null;
    }
    return toAllocationSummary(lookup);
  }
}

let service: AllocationsService;

export function getAllocationsService(): AllocationsService {
  if (!service) {
    service = new AllocationsService();
  }
  return service;
}
