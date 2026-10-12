import { BaseRepository, ConditionalWriteConflictError } from '@api-hub/utils';

import { env } from '../configs/env.config';
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

  async getCanonicalSlot(canonicalPk: string, canonicalSk: string): Promise<SlotItem | null> {
    return this.get<SlotItem>(this.getTableName(), {
      PK: canonicalPk,
      SK: canonicalSk,
    });
  }

  async createSlotIfAbsent(slot: SlotItem, lookup: SlotLookupItem): Promise<'created' | 'exists'> {
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
          await this.put(this.getTableName(), lookup, 'attribute_not_exists(PK)');
        }
        return 'exists';
      }
      const orphanLookup = await this.getSlotLookup(slot.slotId);
      if (orphanLookup?.canonicalPk === slot.PK && orphanLookup.canonicalSk === slot.SK) {
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
    const pk = AvailabilityKeyBuilder.dailyPk(input.vendorId, input.branchId, input.date);
    if (input.fromTime && input.toTime) {
      return this.queryAll<SlotItem>({
        TableName: this.getTableName(),
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':from': AvailabilityKeyBuilder.slotSkFrom(input.fromTime),
          ':to': `${AvailabilityKeyBuilder.slotSkFrom(input.toTime)}#\uffff`,
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

  async querySlotsPage(input: {
    vendorId: string;
    branchId: string;
    date: string;
    limit: number;
    exclusiveStartKey?: Record<string, unknown>;
  }): Promise<{ items: SlotItem[]; lastEvaluatedKey?: Record<string, unknown> }> {
    return this.queryPage<SlotItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': AvailabilityKeyBuilder.dailyPk(input.vendorId, input.branchId, input.date),
        ':prefix': 'SLOT#',
      },
      Limit: input.limit,
      ExclusiveStartKey: input.exclusiveStartKey,
    });
  }

  async setBlocked(slot: SlotItem, blocked: boolean, now: string): Promise<void> {
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
    now: string;
  }): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Update: {
            TableName: this.getTableName(),
            Key: { PK: input.slot.PK, SK: input.slot.SK },
            UpdateExpression:
              'SET heldCount = :heldCount, bookedCount = :bookedCount, updatedAt = :now',
            ConditionExpression: 'heldCount = :readHeld AND bookedCount = :readBooked',
            ExpressionAttributeValues: {
              ':heldCount': input.heldCount,
              ':bookedCount': input.bookedCount,
              ':readHeld': input.readHeld,
              ':readBooked': input.readBooked,
              ':now': input.now,
            },
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
