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

import { MemoryDynamo } from './memory-dynamo.test-helper';
import { AvailabilityService } from '../services/availability.service';
import { SlotsService } from '../services/slots.service';
import { HoldsService } from '../services/holds.service';
import { AllocationsService } from '../services/allocations.service';
import { AvailabilityRepository } from './availability.repository';
import { SlotsRepository } from './slots.repository';
import { HoldsRepository } from './holds.repository';
import { HolidaysRepository } from './holidays.repository';
import { AllocationsRepository } from './allocations.repository';
import { AvailabilityErrors } from '../errors';

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

describe('availability persistence', () => {
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
  const allocations = new AllocationsService(allocationsRepo, slotsRepo, holds, () => fixedNow);

  beforeEach(() => {
    installMemory();
  });

  async function openMonday(): Promise<void> {
    await availability.putworkinghours(
      request({
        userId: 'owner-1',
        vendorId: 'vendor-1',
        body: {
          branchId: 'branch-1',
          timezone: 'Asia/Kolkata',
          hours: [
            { dayOfWeek: 'MON', closed: false, openTime: '09:00', closeTime: '11:00' },
            { dayOfWeek: 'SUN', closed: true },
          ],
        },
      }),
    );
  }

  it('writes daily slot keys and does not reset capacity when generation repeats', async () => {
    await openMonday();
    const first = await slots.postslots(
      request({
        userId: 'owner-1',
        vendorId: 'vendor-1',
        body: {
          branchId: 'branch-1',
          date: '2026-10-12',
          slotDurationMinutes: 60,
          capacity: 1,
          serviceIds: ['haircut'],
          vehicleTypeIds: ['sedan'],
        },
      }),
    );
    expect(first.createdCount).toBe(2);
    expect(first.items[0].available).toBe(1);

    const slotItem = memory.dump().find((item) => item.entityType === 'Slot');
    expect(slotItem?.PK).toBe('VENDOR#vendor-1#BRANCH#branch-1#DATE#2026-10-12');
    expect(String(slotItem?.SK)).toMatch(/^SLOT#09:00#slot_/);
    expect(memory.dump().some((item) => item.entityType === 'SlotLookup' && item.SK === 'META')).toBe(
      true,
    );

    const held = first.items[0];
    await holds.postslotholds(
      request({
        userId: 'customer-1',
        roles: ['customer'],
        headers: { 'Idempotency-Key': 'idem-1' },
        body: { slotId: held.id },
      }),
    );

    const second = await slots.postslots(
      request({
        userId: 'owner-1',
        vendorId: 'vendor-1',
        body: {
          branchId: 'branch-1',
          date: '2026-10-12',
          slotDurationMinutes: 60,
          capacity: 5,
          serviceIds: ['haircut'],
        },
      }),
    );
    expect(second.createdCount).toBe(0);
    expect(second.existingCount).toBe(2);
    expect(second.items.find((item) => item.id === held.id)?.heldCount).toBe(1);
    expect(second.items.find((item) => item.id === held.id)?.capacity).toBe(1);
  });

  it('lets only one of two concurrent holds take the last unit', async () => {
    await openMonday();
    const generated = await slots.postslots(
      request({
        userId: 'owner-1',
        vendorId: 'vendor-1',
        body: {
          branchId: 'branch-1',
          date: '2026-10-12',
          slotDurationMinutes: 120,
          capacity: 1,
        },
      }),
    );
    const slotId = generated.items[0].id;
    const results = await Promise.allSettled([
      holds.postslotholds(
        request({
          userId: 'customer-1',
          roles: ['customer'],
          headers: { 'Idempotency-Key': 'a' },
          body: { slotId },
        }),
      ),
      holds.postslotholds(
        request({
          userId: 'customer-2',
          roles: ['customer'],
          headers: { 'Idempotency-Key': 'b' },
          body: { slotId },
        }),
      ),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AvailabilityErrors.capacityExceeded().constructor);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe('CAPACITY_EXCEEDED');

    const stored = memory.dump().find((item) => item.slotId === slotId && item.entityType === 'Slot');
    expect(stored?.heldCount).toBe(1);
    expect(stored?.bookedCount).toBe(0);
    const activeHolds = memory.dump().filter((item) => item.entityType === 'SlotHold' && item.status === 'active');
    expect(activeHolds).toHaveLength(1);
    expect(String(activeHolds[0].PK)).toContain('DATE#2026-10-12');
    expect(String(activeHolds[0].GSI1PK)).toMatch(/^HOLD_EXPIRY#/);
  });

  it('releases, consumes, and cancels without driving counters negative', async () => {
    await openMonday();
    const generated = await slots.postslots(
      request({
        userId: 'owner-1',
        vendorId: 'vendor-1',
        body: {
          branchId: 'branch-1',
          date: '2026-10-12',
          slotDurationMinutes: 120,
          capacity: 2,
        },
      }),
    );
    const slotId = generated.items[0].id;
    const hold = await holds.postslotholds(
      request({
        userId: 'customer-1',
        roles: ['customer'],
        headers: { 'Idempotency-Key': 'once' },
        body: { slotId },
      }),
    );
    const again = await holds.postslotholds(
      request({
        userId: 'customer-1',
        roles: ['customer'],
        headers: { 'Idempotency-Key': 'once' },
        body: { slotId },
      }),
    );
    expect(again.holdId).toBe(hold.holdId);

    await holds.deleteslothold(
      request({
        userId: 'customer-1',
        roles: ['customer'],
        params: { holdId: hold.holdId },
      }),
    );
    const releasedAgain = await holds.deleteslothold(
      request({
        userId: 'customer-1',
        roles: ['customer'],
        params: { holdId: hold.holdId },
      }),
    );
    expect(releasedAgain.status).toBe('released');
    expect(memory.dump().find((item) => item.entityType === 'Slot' && item.slotId === slotId)?.heldCount).toBe(0);

    const next = await holds.postslotholds(
      request({
        userId: 'customer-1',
        roles: ['customer'],
        headers: { 'Idempotency-Key': 'book' },
        body: { slotId },
      }),
    );
    const consumed = await allocations.consumeHold({
      holdId: next.holdId,
      bookingId: 'booking-1',
    });
    expect(consumed.allocation.status).toBe('confirmed');
    await allocations.consumeHold({ holdId: next.holdId, bookingId: 'booking-1' });
    await expect(
      allocations.consumeHold({ holdId: next.holdId, bookingId: 'booking-2' }),
    ).rejects.toMatchObject({ code: 'HOLD_ALREADY_CONSUMED' });

    const slotAfterBook = memory.dump().find((item) => item.entityType === 'Slot' && item.slotId === slotId);
    expect(slotAfterBook?.heldCount).toBe(0);
    expect(slotAfterBook?.bookedCount).toBe(1);

    await allocations.releaseByBooking({ bookingId: 'booking-1' });
    await allocations.releaseByBooking({ bookingId: 'booking-1' });
    const slotAfterCancel = memory.dump().find((item) => item.entityType === 'Slot' && item.slotId === slotId);
    expect(slotAfterCancel?.bookedCount).toBe(0);
    expect(memory.dump().find((item) => item.entityType === 'AllocationLookup')?.status).toBe('released');
  });

  it('expires an active hold through the hour-bucket query and restores capacity', async () => {
    await openMonday();
    const generated = await slots.postslots(
      request({
        userId: 'owner-1',
        vendorId: 'vendor-1',
        body: {
          branchId: 'branch-1',
          date: '2026-10-12',
          slotDurationMinutes: 120,
          capacity: 1,
        },
      }),
    );
    const early = new HoldsService(
      holdsRepo,
      slotsRepo,
      schedules,
      holidaysRepo,
      allocationsRepo,
      () => new Date('2026-10-12T02:00:00.000Z'),
      60,
    );
    const hold = await early.postslotholds(
      request({
        userId: 'customer-1',
        roles: ['customer'],
        headers: { 'Idempotency-Key': 'expire-me' },
        body: { slotId: generated.items[0].id },
      }),
    );
    const later = new HoldsService(
      holdsRepo,
      slotsRepo,
      schedules,
      holidaysRepo,
      allocationsRepo,
      () => new Date('2026-10-12T03:30:00.000Z'),
      60,
    );
    const result = await later.expireDue(new Date('2026-10-12T03:30:00.000Z'));
    expect(result.expired).toBe(1);
    const storedHold = memory.dump().find((item) => item.holdId === hold.holdId && item.entityType === 'SlotHold');
    expect(storedHold?.status).toBe('expired');
    expect(storedHold?.GSI1PK).toBeUndefined();
    expect(
      memory.dump().find((item) => item.entityType === 'Slot' && item.slotId === generated.items[0].id)?.heldCount,
    ).toBe(0);

    await expect(
      later.consume({ holdId: hold.holdId, bookingId: 'booking-9' }),
    ).rejects.toMatchObject({ code: 'HOLD_EXPIRED' });
  });

  it('hides holiday dates and unknown service eligibility from bookable results', async () => {
    await openMonday();
    await slots.postslots(
      request({
        userId: 'owner-1',
        vendorId: 'vendor-1',
        body: {
          branchId: 'branch-1',
          date: '2026-10-12',
          slotDurationMinutes: 60,
          capacity: 1,
          serviceIds: ['haircut'],
        },
      }),
    );
    const { HolidaysService } = await import('../services/holidays.service');
    const holidays = new HolidaysService(holidaysRepo, schedules, holds);
    await holidays.postholidays(
      request({
        userId: 'owner-1',
        vendorId: 'vendor-1',
        body: { branchId: 'branch-1', date: '2026-10-19', name: 'Holiday' },
      }),
    );
    await slots.postslots(
      request({
        userId: 'owner-1',
        vendorId: 'vendor-1',
        body: {
          branchId: 'branch-1',
          date: '2026-10-19',
          slotDurationMinutes: 60,
          capacity: 1,
          serviceIds: ['haircut'],
        },
      }),
    ).catch((error) => error);

    const bookable = await availability.getavailability(
      request({
        userId: 'customer-1',
        roles: ['customer'],
        vendorId: 'vendor-1',
        params: { branchId: 'branch-1', date: '2026-10-12', serviceId: 'color' },
      }),
    );
    expect(bookable.items).toEqual([]);

    const visible = await availability.getavailability(
      request({
        userId: 'customer-1',
        roles: ['customer'],
        vendorId: 'vendor-1',
        params: { branchId: 'branch-1', date: '2026-10-12', serviceId: 'haircut' },
      }),
    );
    expect(visible.items.length).toBeGreaterThan(0);
    expect(visible.items.every((item) => item.status === 'available')).toBe(true);
  });
});
