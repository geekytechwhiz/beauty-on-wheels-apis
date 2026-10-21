import { BaseRepository } from '@api-hub/utils';
import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import {
  CAPACITY_NAMES,
  CONSUME_HELD_UPDATE,
  CapacitySnapshot,
  OPEN_CAPACITY_NAMES,
  RESTORE_HELD_UPDATE,
  consumeCapacityCondition,
  consumeCapacityValues,
  restoreCapacityCondition,
  restoreCapacityValues,
} from '../domain/capacity-expression';
import { GSI1_INDEX } from '../domain/constants';
import { AvailabilityKeyBuilder } from '../domain/keys';
import {
  HoldIdempotencyItem,
  HoldItem,
  HoldLookupItem,
} from '../types/records';

export class HoldsRepository extends BaseRepository {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getHoldLookup(holdId: string): Promise<HoldLookupItem | null> {
    return this.get<HoldLookupItem>(this.getTableName(), {
      PK: AvailabilityKeyBuilder.holdLookupPk(holdId),
      SK: 'META',
    });
  }

  async getCanonicalHold(
    canonicalPk: string,
    canonicalSk: string,
  ): Promise<HoldItem | null> {
    return this.get<HoldItem>(this.getTableName(), {
      PK: canonicalPk,
      SK: canonicalSk,
    });
  }

  async getIdempotency(
    customerId: string,
    idempotencyKey: string,
  ): Promise<HoldIdempotencyItem | null> {
    return this.get<HoldIdempotencyItem>(this.getTableName(), {
      PK: AvailabilityKeyBuilder.idempotencyPk(customerId, idempotencyKey),
      SK: 'META',
    });
  }

  async createHold(input: {
    slotKey: { PK: string; SK: string };
    snapshot: CapacitySnapshot;
    hold: HoldItem;
    lookup: HoldLookupItem;
    idempotency: HoldIdempotencyItem;
    units: number;
    now: string;
  }): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: input.idempotency,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Update: {
            TableName: this.getTableName(),
            Key: input.slotKey,
            UpdateExpression: CONSUME_HELD_UPDATE,
            ConditionExpression: consumeCapacityCondition(input.snapshot, input.units),
            ExpressionAttributeNames: { ...OPEN_CAPACITY_NAMES },
            ExpressionAttributeValues: consumeCapacityValues(input.snapshot, input.units, input.now),
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: input.hold,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: input.lookup,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    });
  }

  async transitionHold(input: {
    holdKey: { PK: string; SK: string };
    lookupKey: { PK: string; SK: string };
    slotKey: { PK: string; SK: string };
    units: number;
    snapshot: CapacitySnapshot;
    now: string;
    ttl: number;
    nextStatus: 'released' | 'expired';
    requireExpired: boolean;
  }): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Update: {
            TableName: this.getTableName(),
            Key: input.holdKey,
            UpdateExpression:
              'SET #status = :next, updatedAt = :now, #ttl = :ttl REMOVE GSI1PK, GSI1SK',
            ConditionExpression: input.requireExpired
              ? '#status = :active AND expiresAt <= :now'
              : '#status = :active',
            ExpressionAttributeNames: { '#status': 'status', '#ttl': 'ttl' },
            ExpressionAttributeValues: {
              ':active': 'active',
              ':next': input.nextStatus,
              ':now': input.now,
              ':ttl': input.ttl,
            },
          },
        },
        {
          Update: {
            TableName: this.getTableName(),
            Key: input.lookupKey,
            UpdateExpression: 'SET #status = :next, updatedAt = :now',
            ConditionExpression: '#status = :active',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':active': 'active',
              ':next': input.nextStatus,
              ':now': input.now,
            },
          },
        },
        {
          Update: {
            TableName: this.getTableName(),
            Key: input.slotKey,
            UpdateExpression: RESTORE_HELD_UPDATE,
            ConditionExpression: restoreCapacityCondition('heldCount'),
            ExpressionAttributeNames: { ...CAPACITY_NAMES },
            ExpressionAttributeValues: restoreCapacityValues(input.snapshot, input.units, input.now),
          },
        },
      ],
    });
  }

  async listHoldsForSlot(
    vendorId: string,
    branchId: string,
    date: string,
    slotId: string,
  ): Promise<HoldItem[]> {
    return this.queryAll<HoldItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': AvailabilityKeyBuilder.dailyPk(vendorId, branchId, date),
        ':prefix': AvailabilityKeyBuilder.holdPrefix(slotId),
      },
    });
  }

  async listHoldsForDate(
    vendorId: string,
    branchId: string,
    date: string,
  ): Promise<HoldItem[]> {
    return this.queryAll<HoldItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': AvailabilityKeyBuilder.dailyPk(vendorId, branchId, date),
        ':prefix': 'HOLD#',
      },
    });
  }

  async queryExpiryBucket(hourBucket: string, nowIso: string): Promise<HoldItem[]> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: GSI1_INDEX,
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      FilterExpression: '#status = :active AND expiresAt <= :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':pk': AvailabilityKeyBuilder.holdExpiryPk(hourBucket),
        ':prefix': 'HOLD#',
        ':active': 'active',
        ':now': nowIso,
      },
    };
    return this.queryAll<HoldItem>(params);
  }

  async listCustomerHolds(customerId: string): Promise<HoldLookupItem[]> {
    return this.queryAll<HoldLookupItem>({
      TableName: this.getTableName(),
      IndexName: GSI1_INDEX,
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': AvailabilityKeyBuilder.customerHoldPk(customerId),
        ':prefix': 'HOLD#',
      },
      ScanIndexForward: false,
    });
  }
}

let repository: HoldsRepository;

export function getHoldsRepository(): HoldsRepository {
  if (!repository) {
    repository = new HoldsRepository();
  }
  return repository;
}
