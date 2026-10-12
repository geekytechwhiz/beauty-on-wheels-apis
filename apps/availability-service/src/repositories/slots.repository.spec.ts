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
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalWriteConflictError } from '@api-hub/utils';

import { HoldsRepository } from './holds.repository';
import { SlotsRepository } from './slots.repository';
import { HoldItem, HoldLookupItem, SlotItem, SlotLookupItem } from '../types/records';

const ddbMock = mockClient(DynamoDBDocumentClient);

const slot: SlotItem = {
  PK: 'VENDOR#vendor-1#BRANCH#branch-1#DATE#2026-10-12',
  SK: 'SLOT#09:00#slot_abc',
  entityType: 'Slot',
  slotId: 'slot_abc',
  vendorId: 'vendor-1',
  branchId: 'branch-1',
  date: '2026-10-12',
  startTime: '09:00',
  endTime: '10:00',
  timezone: 'Asia/Kolkata',
  durationMinutes: 60,
  capacity: 1,
  heldCount: 0,
  bookedCount: 0,
  status: 'available',
  serviceIds: [],
  vehicleTypeIds: [],
  createdAt: '2026-10-12T03:00:00.000Z',
  updatedAt: '2026-10-12T03:00:00.000Z',
};

describe('availability repositories', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('returns null when a slot lookup is missing', async () => {
    ddbMock.on(GetCommand).resolves({});
    const repository = new SlotsRepository();
    await expect(repository.getSlotLookup('slot_missing')).resolves.toBeNull();
    const input = ddbMock.commandCalls(GetCommand)[0].args[0].input;
    expect(input.Key).toEqual({ PK: 'SLOT#slot_missing', SK: 'META' });
  });

  it('queries a time window on the daily partition without a scan', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [slot] });
    const repository = new SlotsRepository();
    const items = await repository.querySlots({
      vendorId: 'vendor-1',
      branchId: 'branch-1',
      date: '2026-10-12',
      fromTime: '09:00',
      toTime: '10:00',
    });
    expect(items).toHaveLength(1);
    const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(input.IndexName).toBeUndefined();
    expect(input.KeyConditionExpression).toBe('PK = :pk AND SK BETWEEN :from AND :to');
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':pk': 'VENDOR#vendor-1#BRANCH#branch-1#DATE#2026-10-12',
      ':from': 'SLOT#09:00',
    });
  });

  it('blocks a slot only while it is available', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    const repository = new SlotsRepository();
    await repository.setBlocked(slot, true, '2026-10-12T04:00:00.000Z');
    const update = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems?.[0].Update;
    expect(update?.Key).toEqual({ PK: slot.PK, SK: slot.SK });
    expect(update?.ConditionExpression).toBe('attribute_exists(PK) AND #status = :available');
    expect(update?.ExpressionAttributeValues).toMatchObject({ ':next': 'blocked' });
  });

  it('creates a hold with a capacity condition and separate lookup items', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    const repository = new HoldsRepository();
    const hold: HoldItem = {
      PK: slot.PK,
      SK: 'HOLD#slot_abc#hold_1',
      entityType: 'SlotHold',
      holdId: 'hold_1',
      slotId: slot.slotId,
      vendorId: slot.vendorId,
      branchId: slot.branchId,
      customerId: 'customer-1',
      status: 'active',
      units: 1,
      createdAt: slot.createdAt,
      updatedAt: slot.createdAt,
      expiresAt: '2026-10-12T03:10:00.000Z',
      ttl: 1,
      GSI1PK: 'HOLD_EXPIRY#2026-10-12T03',
      GSI1SK: 'HOLD#2026-10-12T03:10:00.000Z#hold_1',
    };
    const lookup: HoldLookupItem = {
      PK: 'HOLD#hold_1',
      SK: 'META',
      entityType: 'HoldLookup',
      holdId: 'hold_1',
      slotId: slot.slotId,
      vendorId: slot.vendorId,
      branchId: slot.branchId,
      customerId: 'customer-1',
      status: 'active',
      units: 1,
      createdAt: slot.createdAt,
      updatedAt: slot.createdAt,
      expiresAt: hold.expiresAt,
      canonicalPk: hold.PK,
      canonicalSk: hold.SK,
      GSI1PK: 'CUSTOMER#customer-1',
      GSI1SK: 'HOLD#2026-10-12T03:00:00.000Z#hold_1',
    };
    await repository.createHold({
      slotKey: { PK: slot.PK, SK: slot.SK },
      hold,
      lookup,
      idempotency: {
        PK: 'IDEMPOTENCY#HOLD#customer-1#key-1',
        SK: 'META',
        entityType: 'HoldIdempotency',
        customerId: 'customer-1',
        idempotencyKey: 'key-1',
        holdId: 'hold_1',
        slotId: slot.slotId,
        createdAt: slot.createdAt,
      },
      units: 1,
      now: slot.createdAt,
    });
    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems ?? [];
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.Update?.Key ?? item.Put?.Item)).toEqual([
      expect.objectContaining({ PK: 'IDEMPOTENCY#HOLD#customer-1#key-1' }),
      { PK: slot.PK, SK: slot.SK },
      expect.objectContaining({ SK: 'HOLD#slot_abc#hold_1' }),
      expect.objectContaining({ PK: 'HOLD#hold_1', SK: 'META' }),
    ]);
    expect(items[1].Update?.ConditionExpression).toContain(
      'capacity >= heldCount + bookedCount + :units',
    );
    const keys = items.map((item) => JSON.stringify(item.Update?.Key ?? {
      PK: item.Put?.Item?.PK,
      SK: item.Put?.Item?.SK,
    }));
    expect(new Set(keys).size).toBe(4);
  });

  it('reads due holds from GSI1 hour buckets', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const repository = new HoldsRepository();
    await repository.queryExpiryBucket('2026-10-12T03', '2026-10-12T03:30:00.000Z');
    const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(input.IndexName).toBe('GSI1');
    expect(input.KeyConditionExpression).toBe('GSI1PK = :pk AND begins_with(GSI1SK, :prefix)');
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':pk': 'HOLD_EXPIRY#2026-10-12T03',
      ':prefix': 'HOLD#',
    });
    expect(input.FilterExpression).toContain('expiresAt <= :now');
  });

  it('maps a failed conditional slot write to a conflict error', async () => {
    const error = new Error('canceled');
    error.name = 'TransactionCanceledException';
    (error as Error & { CancellationReasons: Array<{ Code: string }> }).CancellationReasons = [
      { Code: 'ConditionalCheckFailed' },
      { Code: 'None' },
    ];
    ddbMock.on(TransactWriteCommand).rejects(error);
    ddbMock.on(GetCommand).resolves({});
    const repository = new SlotsRepository();
    const lookup: SlotLookupItem = {
      PK: 'SLOT#slot_abc',
      SK: 'META',
      entityType: 'SlotLookup',
      slotId: slot.slotId,
      vendorId: slot.vendorId,
      branchId: slot.branchId,
      date: slot.date,
      canonicalPk: slot.PK,
      canonicalSk: slot.SK,
      createdAt: slot.createdAt,
    };
    await expect(repository.createSlotIfAbsent(slot, lookup)).rejects.toBeInstanceOf(
      ConditionalWriteConflictError,
    );
  });
});
