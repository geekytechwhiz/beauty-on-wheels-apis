import { BaseRepository, ConditionalWriteConflictError } from '@api-hub/utils';

import { env } from '../configs/env.config';
import { CAPACITY_NAMES } from '../domain/capacity-expression';
import { AvailabilityKeyBuilder } from '../domain/keys';
import { SlotItem, SlotLookupItem } from '../types/records';

export class SlotsRepository extends BaseRepository {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getSlotLookup(slotId: string): Promise<SlotLookupItem | null> {
    return this.get<SlotLookupItem>(this.getTableName(), {
      PK: AvailabilityKeyBuilder.slotLookupPk(slotId),
      SK: 'META',
    });
  }

  async getCanonicalSlot(
    canonicalPk: string,
    canonicalSk: string,
  ): Promise<SlotItem | null> {
    return this.get<SlotItem>(this.getTableName(), {
      PK: canonicalPk,
      SK: canonicalSk,
    });
  }

  async createSlotIfAbsent(
    slot: SlotItem,
    lookup: SlotLookupItem,
  ): Promise<'created' | 'exists'> {
    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: this.getTableName(),
              Item: slot,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: this.getTableName(),
              Item: lookup,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      });
      return 'created';
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) {
        throw error;
      }
      const existing = await this.getCanonicalSlot(slot.PK, slot.SK);
      if (existing) {
        const existingLookup = await this.getSlotLookup(slot.slotId);
        if (!existingLookup) {
          await this.put(
            this.getTableName(),
            lookup,
            'attribute_not_exists(PK)',
          );
        }
        return 'exists';
      }
      const orphanLookup = await this.getSlotLookup(slot.slotId);
      if (
        orphanLookup?.canonicalPk === slot.PK &&
        orphanLookup.canonicalSk === slot.SK
      ) {
        await this.put(this.getTableName(), slot, 'attribute_not_exists(PK)');
        return 'created';
      }
      throw error;
    }
  }

  async querySlots(input: {
    vendorId: string;
    branchId: string;
    date: string;
    fromTime?: string;
    toTime?: string;
  }): Promise<SlotItem[]> {
    const pk = AvailabilityKeyBuilder.dailyPk(
      input.vendorId,
      input.branchId,
      input.date,
    );
    if (input.fromTime && input.toTime) {
      const fromSk = AvailabilityKeyBuilder.slotSkFrom(input.fromTime);
      const toSk = AvailabilityKeyBuilder.slotSkFrom(input.toTime);

      return this.queryAll<SlotItem>({
        TableName: this.getTableName(),
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':from': fromSk,
          ':to': `${toSk}#\uffff`,
        },
      });
    }
    return this.queryAll<SlotItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':prefix': 'SLOT#',
      },
    });
  }

  /**
   * Slots whose start is in [fromTime, toTimeExclusive).
   * The upper bound is the bare `SLOT#{time}` prefix. Stored keys append
   * `#${slotId}`, so they sort after that prefix and stay outside the range.
   */
  async querySlotStarts(input: {
    vendorId: string;
    branchId: string;
    date: string;
    fromTime: string;
    toTimeExclusive: string;
  }): Promise<SlotItem[]> {
    return this.queryAll<SlotItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
      ExpressionAttributeValues: {
        ':pk': AvailabilityKeyBuilder.dailyPk(
          input.vendorId,
          input.branchId,
          input.date,
        ),
        ':from': AvailabilityKeyBuilder.slotSkFrom(input.fromTime),
        ':to': AvailabilityKeyBuilder.slotSkFrom(input.toTimeExclusive),
      },
    });
  }

  async querySlotsPage(input: {
    vendorId: string;
    branchId: string;
    date: string;
    limit: number;
    exclusiveStartKey?: Record<string, unknown>;
  }): Promise<{
    items: SlotItem[];
    lastEvaluatedKey?: Record<string, unknown>;
  }> {
    return this.queryPage<SlotItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': AvailabilityKeyBuilder.dailyPk(
          input.vendorId,
          input.branchId,
          input.date,
        ),
        ':prefix': 'SLOT#',
      },
      Limit: input.limit,
      ExclusiveStartKey: input.exclusiveStartKey,
    });
  }

  async setBlocked(
    slot: SlotItem,
    blocked: boolean,
    now: string,
  ): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Update: {
            TableName: this.getTableName(),
            Key: { PK: slot.PK, SK: slot.SK },
            UpdateExpression: 'SET #status = :next, updatedAt = :now',
            ConditionExpression: blocked
              ? 'attribute_exists(PK) AND #status = :available'
              : 'attribute_exists(PK) AND #status = :blocked',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: blocked
              ? { ':next': 'blocked', ':available': 'available', ':now': now }
              : { ':next': 'available', ':blocked': 'blocked', ':now': now },
          },
        },
      ],
    });
  }

  async replaceCountersIfUnchanged(input: {
    slot: SlotItem;
    readHeld: number;
    readBooked: number;
    heldCount: number;
    bookedCount: number;
    availableCount: number;
    now: string;
  }): Promise<void> {
    const {
      slot,
      readHeld,
      readBooked,
      heldCount,
      bookedCount,
      availableCount,
      now,
    } = input;

    const capacity = slot.capacity;

    // Validate all numeric values.
    const counters = [
      capacity,
      readHeld,
      readBooked,
      heldCount,
      bookedCount,
      availableCount,
    ];

    if (counters.some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw new Error('INVALID_SLOT_COUNTERS');
    }

    // Validate the original snapshot.
    if (readBooked > capacity || readHeld > capacity - readBooked) {
      throw new Error('INVALID_SLOT_CAPACITY_SNAPSHOT');
    }

    // Validate the new counters.
    if (bookedCount > capacity || heldCount > capacity - bookedCount) {
      throw new Error('SLOT_CAPACITY_EXCEEDED');
    }

    const expectedAvailable = capacity - bookedCount - heldCount;

    if (availableCount !== expectedAvailable) {
      throw new Error('SLOT_CAPACITY_INCONSISTENT');
    }

    const readAvailable = capacity - readBooked - readHeld;

    const hasAvailableCount =
      slot.availableCount !== undefined && slot.availableCount !== null;

    // Do not silently overwrite inconsistent
    // existing capacity records.
    if (hasAvailableCount && slot.availableCount !== readAvailable) {
      throw new Error('SLOT_CAPACITY_INCONSISTENT');
    }

    const conditionExpression = [
      'attribute_exists(PK)',
      '#capacity = :capacity',
      'heldCount = :readHeld',
      'bookedCount = :readBooked',
      hasAvailableCount
        ? 'availableCount = :readAvailable'
        : 'attribute_not_exists(availableCount)',
    ].join(' AND ');

    const expressionValues: Record<string, string | number> = {
      ':capacity': capacity,
      ':readHeld': readHeld,
      ':readBooked': readBooked,
      ':heldCount': heldCount,
      ':bookedCount': bookedCount,
      ':availableCount': availableCount,
      ':now': now,
    };

    // Only supply placeholders referenced by
    // the DynamoDB expressions.
    if (hasAvailableCount) {
      expressionValues[':readAvailable'] = readAvailable;
    }

    await this.transactWrite({
      TransactItems: [
        {
          Update: {
            TableName: this.getTableName(),

            Key: {
              PK: slot.PK,
              SK: slot.SK,
            },

            UpdateExpression: [
              'SET heldCount = :heldCount',
              'bookedCount = :bookedCount',
              'availableCount = :availableCount',
              'updatedAt = :now',
            ].join(', '),

            ConditionExpression: conditionExpression,

            ExpressionAttributeNames: {
              ...CAPACITY_NAMES,
            },

            ExpressionAttributeValues: expressionValues,
          },
        },
      ],
    });
  }
}

let repository: SlotsRepository;

export function getSlotsRepository(): SlotsRepository {
  if (!repository) {
    repository = new SlotsRepository();
  }
  return repository;
}
