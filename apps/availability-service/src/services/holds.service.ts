import {
  ConditionalWriteConflictError,
  ForbiddenError,
  LambdaRequest,
  ValidationError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import {
  getAuthenticatedUserId,
  isScheduleManager,
  requirePathId,
} from '../auth/access';
import { env } from '../configs/env.config';
import { hasBookableCapacity, remainingCapacity } from '../domain/capacity';
import { ENTITY_TYPE, HOLD_STATUS } from '../domain/constants';
import { newHoldId } from '../domain/ids';
import { AvailabilityKeyBuilder } from '../domain/keys';
import {
  expiryHourBucket,
  hourBucketsEndingAt,
  isSlotStartInPast,
  weekdayOfCivilDate,
} from '../domain/time';
import { toHoldView } from '../domain/view';
import { AvailabilityErrors } from '../errors';
import { getAllocationsRepository, AllocationsRepository } from '../repositories/allocations.repository';
import { getAvailabilityRepository, AvailabilityRepository } from '../repositories/availability.repository';
import { getHoldsRepository, HoldsRepository } from '../repositories/holds.repository';
import { getHolidaysRepository, HolidaysRepository } from '../repositories/holidays.repository';
import { getSlotsRepository, SlotsRepository } from '../repositories/slots.repository';
import {
  CommunityVisitsService,
  getCommunityVisitsService,
  VisitHoldView,
} from './community-visits.service';
import {
  AllocationItem,
  AllocationLookupItem,
  HoldItem,
  HoldLookupItem,
  HoldReservationView,
  HoldView,
  SlotItem,
} from '../types/records';
import { headerValue, pathParam } from '../utils/request';

const baseLogger = createLogger({
  service: 'holds-service',
  redactPII: true,
});

const RETAIN_SECONDS = 7 * 24 * 60 * 60;

export class HoldsService {
  private readonly logger = createChildLogger(baseLogger, { service: 'HoldsService' });

  constructor(
    private readonly holds: HoldsRepository = getHoldsRepository(),
    private readonly slots: SlotsRepository = getSlotsRepository(),
    private readonly schedules: AvailabilityRepository = getAvailabilityRepository(),
    private readonly holidays: HolidaysRepository = getHolidaysRepository(),
    private readonly allocations: AllocationsRepository = getAllocationsRepository(),
    private readonly now: () => Date = () => new Date(),
    private readonly holdTtlSeconds: number = env.SLOT_HOLD_TTL_SECONDS,
    private readonly communityVisits: CommunityVisitsService = getCommunityVisitsService(),
  ) {}

  async postslotholds(request: LambdaRequest): Promise<HoldView | VisitHoldView> {
    const body = (request.body ?? {}) as {
      slotId?: string;
      visitId?: string;
      vendorId?: string;
      units?: number;
    };
    if (
      request.body &&
      typeof request.body === 'object' &&
      ('holdId' in request.body || 'customerId' in request.body || 'id' in request.body)
    ) {
      throw new ValidationError('holdId, id, and customerId are server-assigned');
    }
    const idempotencyKey = headerValue(request, 'Idempotency-Key');
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw new ValidationError('Idempotency-Key header is required');
    }
    if (body.visitId) {
      const vendorId = typeof body.vendorId === 'string' ? body.vendorId.trim() : '';
      if (!vendorId) {
        throw new ValidationError('vendorId is required when holding a community visit');
      }
      return this.communityVisits.createHold(request, {
        vendorId,
        visitId: requirePathId(body.visitId, 'visitId'),
        units: body.units,
        idempotencyKey,
      });
    }
    const customerId = getAuthenticatedUserId(request);
    const slotId = requireSlotId(body.slotId);
    const units = body.units ?? 1;
    if (!Number.isInteger(units) || units < 1 || units > 20) {
      throw new ValidationError('units must be an integer between 1 and 20');
    }

    const slot = await this.requireSlot(slotId);
    await this.assertSlotBookable(slot, units);
    const instant = this.now();
    const expiresAt = new Date(instant.getTime() + this.holdTtlSeconds * 1000).toISOString();
    const createdAt = instant.toISOString();
    const holdId = newHoldId();
    const built = this.buildHold(slot, {
      holdId,
      customerId,
      units,
      createdAt,
      expiresAt,
      idempotencyKey,
    });

    try {
      await this.holds.createHold({
        slotKey: { PK: slot.PK, SK: slot.SK },
        snapshot: {
          capacity: slot.capacity,
          bookedCount: slot.bookedCount,
          heldCount: slot.heldCount,
        },
        hold: built.hold,
        lookup: built.lookup,
        idempotency: built.idempotency,
        units,
        now: createdAt,
      });
      this.logger.info({
        event: 'hold_created',
        holdId,
        slotId,
        vendorId: slot.vendorId,
        branchId: slot.branchId,
      });
      return toHoldView(built.hold, true);
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) {
        throw error;
      }
      return this.resolveCreateConflict(error, {
        customerId,
        idempotencyKey,
        slot,
        units,
      });
    }
  }

  async deleteslothold(request: LambdaRequest): Promise<HoldView | VisitHoldView> {
    const holdId = pathParam(request, 'holdId');
    const visitHold = await this.communityVisits.findHold(holdId);
    if (visitHold) {
      return this.communityVisits.releaseHold(request, holdId);
    }
    const hold = await this.requireHold(holdId);
    const slot = await this.requireSlot(hold.slotId);
    const schedule = await this.schedules.getWorkingHours(slot.vendorId, slot.branchId);
    const userId = getAuthenticatedUserId(request);
    if (hold.customerId !== userId && !isScheduleManager(request, schedule)) {
      throw new ForbiddenError('Not authorized to release this hold');
    }
    return this.releaseLoadedHold(hold, slot, 'released');
  }

  async getslothold(request: LambdaRequest): Promise<HoldView | VisitHoldView> {
    const holdId = pathParam(request, 'holdId');
    const visitHold = await this.communityVisits.findHold(holdId);
    if (visitHold) {
      const view = await this.communityVisits.getHold(request, holdId);
      if (!view) throw AvailabilityErrors.holdNotFound();
      return view;
    }
    const hold = await this.requireHold(holdId);
    const schedule = await this.schedules.getWorkingHours(hold.vendorId, hold.branchId);
    const userId = getAuthenticatedUserId(request);
    const manager = isScheduleManager(request, schedule);
    if (hold.customerId !== userId && !manager) {
      throw new ForbiddenError('Not authorized to read this hold');
    }
    return toHoldView(hold, manager || hold.customerId === userId);
  }

  async releaseLoadedHold(
    hold: HoldItem,
    slot: SlotItem,
    nextStatus: 'released' | 'expired',
  ): Promise<HoldView> {
    if (hold.status === nextStatus || (nextStatus === 'released' && hold.status === 'released')) {
      return toHoldView(hold, true);
    }
    if (hold.status === HOLD_STATUS.CONSUMED) {
      throw AvailabilityErrors.holdAlreadyConsumed();
    }
    if (hold.status === HOLD_STATUS.EXPIRED || hold.status === HOLD_STATUS.RELEASED) {
      return toHoldView(hold, true);
    }
    const instant = this.now();
    const nowIso = instant.toISOString();
    if (nextStatus === 'expired' && hold.expiresAt > nowIso) {
      return toHoldView(hold, true);
    }
    const lookup = await this.holds.getHoldLookup(hold.holdId);
    if (!lookup) {
      throw AvailabilityErrors.holdNotFound();
    }
    try {
      await this.holds.transitionHold({
        holdKey: { PK: hold.PK, SK: hold.SK },
        lookupKey: { PK: lookup.PK, SK: lookup.SK },
        slotKey: { PK: slot.PK, SK: slot.SK },
        units: hold.units,
        snapshot: {
          capacity: slot.capacity,
          bookedCount: slot.bookedCount,
          heldCount: slot.heldCount,
        },
        now: nowIso,
        ttl: Math.floor(instant.getTime() / 1000) + RETAIN_SECONDS,
        nextStatus,
        requireExpired: nextStatus === 'expired',
      });
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) {
        throw error;
      }
      const current = await this.requireHold(hold.holdId);
      if (current.status === nextStatus || current.status === HOLD_STATUS.RELEASED || current.status === HOLD_STATUS.EXPIRED) {
        return toHoldView(current, true);
      }
      if (current.status === HOLD_STATUS.CONSUMED) {
        throw AvailabilityErrors.holdAlreadyConsumed();
      }
      throw error;
    }
    const updated = await this.requireHold(hold.holdId);
    this.logger.info({
      event: nextStatus === 'expired' ? 'hold_expired' : 'hold_released',
      holdId: hold.holdId,
      slotId: hold.slotId,
    });
    return toHoldView(updated, true);
  }

  async consume(input: { holdId: string; bookingId: string; customerId?: string }): Promise<{
    hold: HoldView | VisitHoldView;
    allocation: { bookingId: string; slotId?: string; visitId?: string; status: string };
    reservation?: HoldReservationView;
  }> {
    const bookingId = requirePathId(input.bookingId, 'bookingId');
    const holdId = requirePathId(input.holdId, 'holdId');
    const customerId = input.customerId?.trim() || undefined;
    const visitHold = await this.communityVisits.findHold(holdId);
    if (visitHold) {
      assertHoldOwner(visitHold.customerId, customerId);
      const confirmed = await this.communityVisits.confirmHold({ holdId, bookingId });
      return {
        hold: confirmed.hold,
        allocation: {
          bookingId,
          visitId: confirmed.hold.visitId,
          status: 'confirmed',
        },
      };
    }
    const hold = await this.requireHold(holdId);
    assertHoldOwner(hold.customerId, customerId);
    if (hold.status === HOLD_STATUS.CONSUMED) {
      if (hold.bookingId === bookingId) {
        return this.consumedResult(hold, bookingId);
      }
      throw AvailabilityErrors.holdAlreadyConsumed();
    }
    if (hold.status === HOLD_STATUS.EXPIRED || hold.expiresAt <= this.now().toISOString()) {
      if (hold.status === HOLD_STATUS.ACTIVE) {
        const slot = await this.requireSlot(hold.slotId);
        await this.releaseLoadedHold(hold, slot, 'expired');
      }
      throw AvailabilityErrors.holdExpired();
    }
    if (hold.status !== HOLD_STATUS.ACTIVE) {
      throw AvailabilityErrors.slotUnavailable('Hold is not active');
    }
    const slot = await this.requireSlot(hold.slotId);
    const lookup = await this.holds.getHoldLookup(hold.holdId);
    if (!lookup) {
      throw AvailabilityErrors.holdNotFound();
    }
    const instant = this.now();
    const nowIso = instant.toISOString();
    const allocation = this.buildAllocation(hold, slot, bookingId, nowIso);
    try {
      await this.allocations.consumeHold({
        hold,
        lookup,
        slotKey: { PK: slot.PK, SK: slot.SK },
        allocation: allocation.item,
        allocationLookup: allocation.lookup,
        now: nowIso,
        ttl: Math.floor(instant.getTime() / 1000) + RETAIN_SECONDS,
      });
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) {
        throw error;
      }
      const current = await this.requireHold(hold.holdId);
      if (current.status === HOLD_STATUS.CONSUMED && current.bookingId === bookingId) {
        return this.consumedResult(current, bookingId, slot);
      }
      if (current.status === HOLD_STATUS.CONSUMED) {
        throw AvailabilityErrors.holdAlreadyConsumed();
      }
      if (current.status === HOLD_STATUS.EXPIRED || current.expiresAt <= nowIso) {
        throw AvailabilityErrors.holdExpired();
      }
      throw AvailabilityErrors.idempotencyConflict();
    }
    this.logger.info({
      event: 'hold_consumed',
      holdId: hold.holdId,
      bookingId,
      slotId: hold.slotId,
    });
    return this.consumedResult({ ...hold, status: HOLD_STATUS.CONSUMED, bookingId }, bookingId, slot);
  }

  private async consumedResult(hold: HoldItem, bookingId: string, loadedSlot?: SlotItem) {
    const slot = loadedSlot ?? (await this.requireSlot(hold.slotId));
    return {
      hold: toHoldView(hold, true),
      allocation: { bookingId, slotId: hold.slotId, status: 'confirmed' },
      reservation: toHoldReservation(hold, slot),
    };
  }

  async expireDue(instant = this.now()): Promise<{ expired: number; failed: number }> {
    const buckets = hourBucketsEndingAt(instant, env.EXPIRY_LOOKBACK_HOURS);
    const seen = new Set<string>();
    let expired = 0;
    let failed = 0;
    const nowIso = instant.toISOString();
    for (const bucket of buckets) {
      const candidates = await this.holds.queryExpiryBucket(bucket, nowIso);
      for (const hold of candidates) {
        if (seen.has(hold.holdId) || hold.status !== HOLD_STATUS.ACTIVE || !hold.slotId) {
          continue;
        }
        seen.add(hold.holdId);
        try {
          const slot = await this.requireSlot(hold.slotId);
          await this.releaseLoadedHold(hold, slot, 'expired');
          expired += 1;
          await this.reconcileSlot(slot);
        } catch (error) {
          failed += 1;
          this.logger.error({
            event: 'hold_expire_failed',
            holdId: hold.holdId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    const visitExpiry = await this.communityVisits.expireDueHolds(instant);
    return { expired: expired + visitExpiry.expired, failed: failed + visitExpiry.failed };
  }

  async reconcileSlot(slot: SlotItem): Promise<void> {
    const [holds, allocations] = await Promise.all([
      this.holds.listHoldsForDate(slot.vendorId, slot.branchId, slot.date),
      this.allocations.listForDate(slot.vendorId, slot.branchId, slot.date),
    ]);
    const heldCount = holds
      .filter((hold) => hold.slotId === slot.slotId && hold.status === HOLD_STATUS.ACTIVE)
      .reduce((sum, hold) => sum + hold.units, 0);
    const bookedCount = allocations
      .filter((allocation) => allocation.slotId === slot.slotId && allocation.status === 'confirmed')
      .reduce((sum, allocation) => sum + allocation.units, 0);
    const current = await this.requireSlot(slot.slotId);
    const availableCount = Math.max(0, current.capacity - heldCount - bookedCount);
    if (
      current.heldCount === heldCount
      && current.bookedCount === bookedCount
      && current.availableCount === availableCount
    ) {
      return;
    }
    try {
      await this.slots.replaceCountersIfUnchanged({
        slot: current,
        readHeld: current.heldCount,
        readBooked: current.bookedCount,
        heldCount,
        bookedCount,
        availableCount,
        now: this.now().toISOString(),
      });
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) {
        throw error;
      }
    }
  }

  private async resolveCreateConflict(
    error: ConditionalWriteConflictError,
    input: {
      customerId: string;
      idempotencyKey: string;
      slot: SlotItem;
      units: number;
    },
  ): Promise<HoldView> {
    const failed = error.failedTransactItemIndexes ?? [];
    if (failed.includes(0)) {
      const existing = await this.holds.getIdempotency(input.customerId, input.idempotencyKey);
      if (!existing) {
        throw AvailabilityErrors.idempotencyConflict();
      }
      if (existing.slotId !== input.slot.slotId) {
        throw AvailabilityErrors.idempotencyConflict();
      }
      const hold = await this.requireHold(existing.holdId);
      return toHoldView(hold, true);
    }
    const slot = await this.requireSlot(input.slot.slotId);
    if (slot.status === 'blocked') {
      throw AvailabilityErrors.slotBlocked();
    }
    if (remainingCapacity(slot) < input.units) {
      throw AvailabilityErrors.capacityExceeded();
    }
    throw AvailabilityErrors.slotUnavailable();
  }

  private async assertSlotBookable(slot: SlotItem, units: number): Promise<void> {
    if (slot.status === 'blocked') {
      throw AvailabilityErrors.slotBlocked();
    }
    if (!hasBookableCapacity(slot, units)) {
      throw AvailabilityErrors.capacityExceeded();
    }
    if (isSlotStartInPast(slot.date, slot.startTime, slot.timezone, this.now())) {
      throw AvailabilityErrors.slotUnavailable('Slot start time has passed');
    }
    const closed = await this.isClosed(slot.vendorId, slot.branchId, slot.date, Boolean(slot.visitId));
    if (closed) {
      throw AvailabilityErrors.vendorNotAvailable('Vendor is closed on this date');
    }
  }

  private async isClosed(vendorId: string, branchId: string, date: string, visitSlot = false): Promise<boolean> {
    const [branchHolidays, vendorHolidays, schedule] = await Promise.all([
      this.holidays.listBranchHolidays(vendorId, branchId),
      this.holidays.listVendorHolidays(vendorId),
      visitSlot ? Promise.resolve(null) : this.schedules.getWorkingHours(vendorId, branchId),
    ]);
    if (
      branchHolidays.some((holiday) => holiday.date === date) ||
      vendorHolidays.some((holiday) => holiday.date === date)
    ) {
      return true;
    }
    if (visitSlot) {
      return false;
    }
    if (!schedule) {
      return true;
    }
    const day = schedule.hours.find((entry) => entry.dayOfWeek === weekdayOfCivilDate(date));
    return !day || day.closed;
  }

  private buildHold(
    slot: SlotItem,
    input: {
      holdId: string;
      customerId: string;
      units: number;
      createdAt: string;
      expiresAt: string;
      idempotencyKey: string;
    },
  ) {
    const canonicalPk = slot.PK;
    const canonicalSk = AvailabilityKeyBuilder.holdSk(slot.slotId, input.holdId);
    const hold: HoldItem = {
      PK: canonicalPk,
      SK: canonicalSk,
      entityType: ENTITY_TYPE.HOLD,
      holdId: input.holdId,
      slotId: slot.slotId,
      vendorId: slot.vendorId,
      branchId: slot.branchId,
      customerId: input.customerId,
      status: HOLD_STATUS.ACTIVE,
      units: input.units,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      expiresAt: input.expiresAt,
      ttl: Math.floor(new Date(input.expiresAt).getTime() / 1000) + 24 * 60 * 60,
      GSI1PK: AvailabilityKeyBuilder.holdExpiryPk(expiryHourBucket(input.expiresAt)),
      GSI1SK: AvailabilityKeyBuilder.holdExpirySk(input.expiresAt, input.holdId),
    };
    const lookup: HoldLookupItem = {
      PK: AvailabilityKeyBuilder.holdLookupPk(input.holdId),
      SK: 'META',
      entityType: ENTITY_TYPE.HOLD_LOOKUP,
      holdId: input.holdId,
      slotId: slot.slotId,
      vendorId: slot.vendorId,
      branchId: slot.branchId,
      customerId: input.customerId,
      status: HOLD_STATUS.ACTIVE,
      units: input.units,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      expiresAt: input.expiresAt,
      canonicalPk,
      canonicalSk,
      GSI1PK: AvailabilityKeyBuilder.customerHoldPk(input.customerId),
      GSI1SK: AvailabilityKeyBuilder.customerHoldSk(input.createdAt, input.holdId),
    };
    return {
      hold,
      lookup,
      idempotency: {
        PK: AvailabilityKeyBuilder.idempotencyPk(input.customerId, input.idempotencyKey),
        SK: 'META',
        entityType: ENTITY_TYPE.HOLD_IDEMPOTENCY,
        customerId: input.customerId,
        idempotencyKey: input.idempotencyKey,
        holdId: input.holdId,
        slotId: slot.slotId,
        createdAt: input.createdAt,
      },
    };
  }

  private buildAllocation(hold: HoldItem, slot: SlotItem, bookingId: string, nowIso: string): {
    item: AllocationItem;
    lookup: AllocationLookupItem;
  } {
    const canonicalPk = slot.PK;
    const canonicalSk = AvailabilityKeyBuilder.allocationSk(slot.slotId, bookingId);
    return {
      item: {
        PK: canonicalPk,
        SK: canonicalSk,
        entityType: ENTITY_TYPE.ALLOCATION,
        bookingId,
        holdId: hold.holdId,
        slotId: slot.slotId,
        vendorId: slot.vendorId,
        branchId: slot.branchId,
        customerId: hold.customerId,
        units: hold.units,
        status: 'confirmed',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      lookup: {
        PK: AvailabilityKeyBuilder.allocationLookupPk(bookingId),
        SK: AvailabilityKeyBuilder.allocationLookupSk(),
        entityType: ENTITY_TYPE.ALLOCATION_LOOKUP,
        bookingId,
        holdId: hold.holdId,
        slotId: slot.slotId,
        vendorId: slot.vendorId,
        branchId: slot.branchId,
        customerId: hold.customerId,
        units: hold.units,
        status: 'confirmed',
        canonicalPk,
        canonicalSk,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    };
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

  private async requireHold(holdId: string): Promise<HoldItem> {
    const lookup = await this.holds.getHoldLookup(holdId);
    if (!lookup) {
      throw AvailabilityErrors.holdNotFound();
    }
    const hold = await this.holds.getCanonicalHold(lookup.canonicalPk, lookup.canonicalSk);
    if (!hold) {
      throw AvailabilityErrors.holdNotFound();
    }
    return hold;
  }
}

function assertHoldOwner(holdCustomerId: string, customerId: string | undefined): void {
  if (customerId && holdCustomerId !== customerId) {
    throw new ForbiddenError('Hold belongs to a different customer');
  }
}

function toHoldReservation(hold: HoldItem, slot: SlotItem): HoldReservationView {
  return {
    holdId: hold.holdId,
    slotId: slot.slotId,
    vendorId: hold.vendorId,
    branchId: hold.branchId,
    customerId: hold.customerId,
    date: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    timezone: slot.timezone,
    durationMinutes: slot.durationMinutes,
  };
}

function requireSlotId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('slotId is required');
  }
  return requirePathId(value, 'slotId');
}

let service: HoldsService;

export function getHoldsService(): HoldsService {
  if (!service) {
    service = new HoldsService();
  }
  return service;
}
