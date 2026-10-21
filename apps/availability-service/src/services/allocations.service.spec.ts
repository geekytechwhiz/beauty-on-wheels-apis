jest.mock('../configs/env.config', () => ({
  env: {
    DYNAMODB_TABLE_NAME: 'availability-test',
    SERVICE_NAME: 'availability-service',
    LOG_LEVEL: 'silent',
    EVENT_BUS_NAME: '',
    SLOT_HOLD_TTL_SECONDS: 600,
    EXPIRY_LOOKBACK_HOURS: 48,
  },
}));

import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { LambdaRequest } from '@api-hub/utils';

import { MemoryDynamo } from '../repositories/memory-dynamo.test-helper';
import { AvailabilityService } from './availability.service';
import { SlotsService } from './slots.service';
import { HoldsService } from './holds.service';
import { AllocationsService } from './allocations.service';
import { AvailabilityRepository } from '../repositories/availability.repository';
import { SlotsRepository } from '../repositories/slots.repository';
import { HoldsRepository } from '../repositories/holds.repository';
import { HolidaysRepository } from '../repositories/holidays.repository';
import { AllocationsRepository } from '../repositories/allocations.repository';
import { AvailabilityKeyBuilder } from '../domain/keys';
import { SlotItem, SlotLookupItem } from '../types/records';

const ddbMock = mockClient(DynamoDBDocumentClient);
const memory = new MemoryDynamo();

function installMemory(): void {
  ddbMock.reset();
  memory.reset();
  ddbMock.on(GetCommand).callsFake(async (input) => {
    return memory.exclusive(() => ({ Item: memory.get(input.Key as { PK: string; SK: string }) }));
  });
  ddbMock.on(PutCommand).callsFake(async (input) => {
    await memory.exclusive(() => memory.put(input as unknown as Record<string, unknown>));
    return {};
  });
  ddbMock.on(QueryCommand).callsFake(async (input) => {
    return memory.exclusive(() => memory.query(input as unknown as Record<string, unknown>));
  });
  ddbMock.on(TransactWriteCommand).callsFake(async (input) => {
    await memory.exclusive(() =>
      memory.transact(input as { TransactItems?: Array<Record<string, Record<string, unknown>>> }),
    );
    return {};
  });
}

function request(partial: {
  userId: string;
  roles?: string[];
  vendorId?: string;
  params?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}): LambdaRequest {
  return {
    pathParameters: partial.vendorId ? { vendorId: partial.vendorId } : {},
    params: {
      ...(partial.vendorId ? { vendorId: partial.vendorId } : {}),
      ...(partial.params ?? {}),
    },
    body: partial.body,
    event: {
      headers: partial.headers ?? {},
      queryStringParameters: partial.params ?? null,
    },
    context: {
      authContext: {
        identityId: 'identity',
        userId: partial.userId,
        roles: partial.roles ?? ['vendor'],
        permissions: [],
        claims: {},
      },
      userContext: { userId: partial.userId, roles: partial.roles ?? ['vendor'] },
    },
  } as unknown as LambdaRequest;
}

describe('reserveBooking capacity blocks', () => {
  const schedules = new AvailabilityRepository();
  const slotsRepo = new SlotsRepository();
  const holdsRepo = new HoldsRepository();
  const holidaysRepo = new HolidaysRepository();
  const allocationsRepo = new AllocationsRepository();
  const fixedNow = new Date('2026-10-12T03:00:00.000Z');
  const slots = new SlotsService(slotsRepo, schedules, holidaysRepo, () => fixedNow);
  const holds = new HoldsService(
    holdsRepo,
    slotsRepo,
    schedules,
    holidaysRepo,
    allocationsRepo,
    () => fixedNow,
    600,
  );
  const availability = new AvailabilityService(schedules, slots);
  const allocations = new AllocationsService(
    allocationsRepo,
    slotsRepo,
    holds,
    () => fixedNow,
    schedules,
    holidaysRepo,
  );

  beforeEach(() => {
    installMemory();
  });

  async function openHours(closeTime = '12:00'): Promise<void> {
    await availability.putworkinghours(request({
      userId: 'owner-1',
      vendorId: 'vendor-1',
      body: {
        branchId: 'branch-1',
        timezone: 'Asia/Kolkata',
        hours: [{ dayOfWeek: 'MON', closed: false, openTime: '09:00', closeTime }],
      },
    }));
  }

  async function generate(duration = 30, capacity = 2, extra: Record<string, unknown> = {}): Promise<void> {
    await slots.postslots(request({
      userId: 'owner-1',
      vendorId: 'vendor-1',
      body: {
        branchId: 'branch-1',
        date: '2026-10-12',
        slotDurationMinutes: duration,
        capacity,
        ...extra,
      },
    }));
  }

  function reserve(overrides: Record<string, unknown> = {}) {
    return allocations.reserveBooking({
      bookingId: 'booking-1',
      customerId: 'customer-1',
      vendorId: 'vendor-1',
      branchId: 'branch-1',
      offeringId: 'svc_polish',
      vehicleType: 'HATCHBACK',
      date: '2026-10-12',
      startTime: '09:00',
      timezone: 'Asia/Kolkata',
      durationMinutes: 30,
      ...overrides,
    });
  }

  function booked(startTime: string): number {
    const slot = memory.dump().find((item) => item.entityType === 'Slot' && item.startTime === startTime);
    return Number(slot?.bookedCount ?? 0);
  }

  function held(startTime: string): number {
    const slot = memory.dump().find((item) => item.entityType === 'Slot' && item.startTime === startTime);
    return Number(slot?.heldCount ?? 0);
  }

  async function putSlot(input: {
    slotId: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    capacity?: number;
    bookedCount?: number;
    heldCount?: number;
    status?: 'available' | 'blocked';
    serviceIds?: string[];
    vehicleTypeIds?: string[];
  }): Promise<void> {
    const item: SlotItem = {
      PK: AvailabilityKeyBuilder.dailyPk('vendor-1', 'branch-1', '2026-10-12'),
      SK: AvailabilityKeyBuilder.slotSk(input.startTime, input.slotId),
      entityType: 'Slot',
      slotId: input.slotId,
      vendorId: 'vendor-1',
      branchId: 'branch-1',
      date: '2026-10-12',
      startTime: input.startTime,
      endTime: input.endTime,
      timezone: 'Asia/Kolkata',
      durationMinutes: input.durationMinutes,
      capacity: input.capacity ?? 1,
      heldCount: input.heldCount ?? 0,
      bookedCount: input.bookedCount ?? 0,
      status: input.status ?? 'available',
      serviceIds: input.serviceIds ?? [],
      vehicleTypeIds: input.vehicleTypeIds ?? [],
      createdAt: fixedNow.toISOString(),
      updatedAt: fixedNow.toISOString(),
    };
    const lookup: SlotLookupItem = {
      PK: AvailabilityKeyBuilder.slotLookupPk(input.slotId),
      SK: 'META',
      entityType: 'SlotLookup',
      slotId: input.slotId,
      vendorId: item.vendorId,
      branchId: item.branchId,
      date: item.date,
      canonicalPk: item.PK,
      canonicalSk: item.SK,
      createdAt: item.createdAt,
    };
    await slotsRepo.createSlotIfAbsent(item, lookup);
  }

  it('reserves an unrestricted 30 minute block for the reported empty service list', async () => {
    await openHours();
    await generate(30, 2);
    const result = await reserve();
    expect(result).toMatchObject({
      date: '2026-10-12',
      startTime: '09:00',
      endTime: '09:30',
      timezone: 'Asia/Kolkata',
      durationMinutes: 30,
    });
    expect(booked('09:00')).toBe(1);
    expect(booked('09:30')).toBe(0);
    const lookup = memory.dump().find((item) => item.entityType === 'AllocationLookup');
    expect(lookup?.status).toBe('confirmed');
    expect(lookup?.slotIds).toEqual([result.slotId]);
  });

  it.each([
    [45, '09:45', ['09:00', '09:30']],
    [60, '10:00', ['09:00', '09:30']],
    [70, '10:10', ['09:00', '09:30', '10:00']],
    [90, '10:30', ['09:00', '09:30', '10:00']],
  ])('reserves a %i minute service through %s', async (durationMinutes, endTime, starts) => {
    await openHours();
    await generate(30, 2);
    const result = await reserve({ durationMinutes });
    expect(result.endTime).toBe(endTime);
    expect(result.durationMinutes).toBe(durationMinutes);
    for (const start of ['09:00', '09:30', '10:00', '10:30']) {
      expect(booked(start)).toBe(starts.includes(start) ? 1 : 0);
    }
    const lookup = memory.dump().find((item) => item.entityType === 'AllocationLookup');
    expect(lookup?.slotIds).toHaveLength(starts.length);
    expect(lookup?.coveredSlots).toHaveLength(starts.length);
  });

  it('rejects a restricted service or vehicle without writing capacity', async () => {
    await openHours();
    await generate(30, 1, { serviceIds: ['haircut'], vehicleTypeIds: ['SEDAN'] });
    await expect(reserve({ offeringId: 'color' })).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    await expect(reserve({ offeringId: 'haircut', vehicleType: 'SUV' })).rejects.toMatchObject({
      code: 'SLOT_UNAVAILABLE',
    });
    expect(booked('09:00')).toBe(0);
    const matched = await reserve({ offeringId: 'haircut', vehicleType: 'sedan' });
    expect(matched.durationMinutes).toBe(30);
    expect(booked('09:00')).toBe(1);
  });

  it('rejects a missing block, a blocked intermediate block, and a full or held block', async () => {
    await openHours();
    await putSlot({ slotId: 'slot_0900', startTime: '09:00', endTime: '09:30', durationMinutes: 30, capacity: 1 });
    await putSlot({ slotId: 'slot_1000', startTime: '10:00', endTime: '10:30', durationMinutes: 30, capacity: 1 });
    await expect(reserve({ durationMinutes: 60 })).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect(booked('09:00')).toBe(0);

    await putSlot({ slotId: 'slot_0930', startTime: '09:30', endTime: '10:00', durationMinutes: 30, capacity: 1, status: 'blocked' });
    await expect(reserve({ durationMinutes: 60 })).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });
    expect(booked('09:00')).toBe(0);

    const blocked = memory.dump().find((item) => item.slotId === 'slot_0930' && item.entityType === 'Slot') as unknown as SlotItem;
    await slotsRepo.setBlocked(blocked, false, fixedNow.toISOString());
    await putSlot({
      slotId: 'slot_held',
      startTime: '11:00',
      endTime: '11:30',
      durationMinutes: 30,
      capacity: 1,
      heldCount: 1,
    });
    await expect(reserve({ startTime: '11:00', durationMinutes: 30 })).rejects.toMatchObject({
      code: 'CAPACITY_EXCEEDED',
    });
    expect(held('11:00')).toBe(1);
    expect(booked('11:00')).toBe(0);
  });

  it('rejects a reservation that runs past working hours', async () => {
    await openHours('10:00');
    await generate(30, 1);
    await expect(reserve({ durationMinutes: 90 })).rejects.toMatchObject({ code: 'VENDOR_NOT_AVAILABLE' });
    expect(booked('09:00')).toBe(0);
  });

  it('lets capacity 2 accept two bookings and rejects the third', async () => {
    await openHours();
    await generate(30, 2);
    await reserve({ bookingId: 'booking-1' });
    await reserve({ bookingId: 'booking-2', customerId: 'customer-2' });
    await expect(reserve({ bookingId: 'booking-3', customerId: 'customer-3' })).rejects.toMatchObject({
      code: 'CAPACITY_EXCEEDED',
    });
    expect(booked('09:00')).toBe(2);
  });

  it('reserves a slot written before availableCount existed', async () => {
    await openHours();
    await putSlot({ slotId: 'slot_0900', startTime: '09:00', endTime: '09:30', durationMinutes: 30, capacity: 2 });
    await reserve({ bookingId: 'booking-1' });
    await reserve({ bookingId: 'booking-2', customerId: 'customer-2' });
    await expect(reserve({ bookingId: 'booking-3', customerId: 'customer-3' })).rejects.toMatchObject({
      code: 'CAPACITY_EXCEEDED',
    });
    const stored = memory.dump().find((item) => item.entityType === 'Slot' && item.slotId === 'slot_0900');
    expect(stored?.bookedCount).toBe(2);
    expect(stored?.availableCount).toBe(0);
    await allocations.releaseByBooking({ bookingId: 'booking-2' });
    const released = memory.dump().find((item) => item.entityType === 'Slot' && item.slotId === 'slot_0900');
    expect(released?.bookedCount).toBe(1);
    expect(released?.availableCount).toBe(1);
  });

  it('gives the last unit to only one concurrent reservation', async () => {
    await openHours();
    await generate(30, 1);
    const results = await Promise.allSettled([
      reserve({ bookingId: 'booking-1', customerId: 'customer-1' }),
      reserve({ bookingId: 'booking-2', customerId: 'customer-2' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(booked('09:00')).toBe(1);
    expect(memory.dump().filter((item) => item.entityType === 'SlotAllocation')).toHaveLength(1);
  });

  it('rolls back a concurrent multi-block reservation when the last unit is taken', async () => {
    await openHours();
    await generate(30, 1);
    const results = await Promise.allSettled([
      reserve({ bookingId: 'booking-1', customerId: 'customer-1', durationMinutes: 60 }),
      reserve({ bookingId: 'booking-2', customerId: 'customer-2', durationMinutes: 60 }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(booked('09:00')).toBe(1);
    expect(booked('09:30')).toBe(1);
    expect(booked('10:00')).toBe(0);
    expect(memory.dump().filter((item) => item.entityType === 'SlotAllocation')).toHaveLength(1);
  });

  it('occupies every overlapping slot id and then rejects a second overlapping booking', async () => {
    await openHours();
    await putSlot({ slotId: 'slot_long', startTime: '09:00', endTime: '10:00', durationMinutes: 60, capacity: 1 });
    await putSlot({ slotId: 'slot_short', startTime: '09:00', endTime: '09:30', durationMinutes: 30, capacity: 1 });
    const first = await reserve({ durationMinutes: 30 });
    expect(booked('09:00')).toBe(1);
    expect(memory.dump().filter((item) => item.entityType === 'Slot' && item.bookedCount === 1)).toHaveLength(2);
    await expect(reserve({
      bookingId: 'booking-2',
      customerId: 'customer-2',
      durationMinutes: 30,
    })).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });
    expect(['slot_long', 'slot_short']).toContain(first.slotId);
  });

  it('returns the original reservation for a duplicate and rejects a conflicting retry', async () => {
    await openHours();
    await generate(30, 2);
    const first = await reserve({ durationMinutes: 45 });
    const again = await reserve({ durationMinutes: 45 });
    expect(again).toEqual(first);
    expect(booked('09:00')).toBe(1);
    expect(booked('09:30')).toBe(1);
    await expect(reserve({ durationMinutes: 90 })).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    await expect(reserve({ startTime: '10:00', durationMinutes: 45 })).rejects.toMatchObject({
      code: 'SLOT_UNAVAILABLE',
    });
    expect(booked('10:00')).toBe(0);
    expect(memory.dump().filter((item) => item.entityType === 'SlotAllocation')).toHaveLength(1);
  });

  it('is idempotent for the same booking racing itself', async () => {
    await openHours();
    await generate(30, 1);
    const results = await Promise.allSettled([
      reserve({ bookingId: 'booking-1', durationMinutes: 60 }),
      reserve({ bookingId: 'booking-1', durationMinutes: 60 }),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(booked('09:00')).toBe(1);
    expect(booked('09:30')).toBe(1);
    expect(memory.dump().filter((item) => item.entityType === 'SlotAllocation')).toHaveLength(1);
  });

  it('releases every block once, ignores a repeated cancel, and allows a new booking', async () => {
    await openHours();
    await generate(30, 1);
    await reserve({ durationMinutes: 60 });
    await allocations.releaseByBooking({ bookingId: 'booking-1' });
    await allocations.releaseByBooking({ bookingId: 'booking-1' });
    expect(booked('09:00')).toBe(0);
    expect(booked('09:30')).toBe(0);
    expect(memory.dump().find((item) => item.entityType === 'AllocationLookup')?.status).toBe('released');
    await expect(reserve({ durationMinutes: 60 })).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    const next = await reserve({ bookingId: 'booking-2', customerId: 'customer-2', durationMinutes: 60 });
    expect(next.endTime).toBe('10:00');
    expect(booked('09:00')).toBe(1);
    expect(booked('09:30')).toBe(1);
  });

  it('keeps a customer hold from being double-booked and still lists spanning starts', async () => {
    await openHours();
    await generate(30, 1);
    const listed = await slots.getslots(request({
      userId: 'customer-1',
      roles: ['customer'],
      vendorId: 'vendor-1',
      params: {
        branchId: 'branch-1',
        date: '2026-10-12',
        serviceId: 'svc_polish',
        vehicleTypeId: 'SUV',
        serviceDurationMinutes: '45',
        bookable: 'true',
      },
    }));
    expect(listed.items.map((item) => item.startTime)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
    const slotId = listed.items[0].id;
    await holds.postslotholds(request({
      userId: 'customer-1',
      roles: ['customer'],
      headers: { 'Idempotency-Key': 'hold-1' },
      body: { slotId },
    }));
    await expect(reserve()).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' });
    expect(held('09:00')).toBe(1);
    expect(booked('09:00')).toBe(0);
  });
});
