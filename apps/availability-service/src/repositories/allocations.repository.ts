import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import { AvailabilityKeyBuilder } from '../domain/keys';
import {
  AllocationItem,
  AllocationLookupItem,
  HoldItem,
  HoldLookupItem,
} from '../types/records';

export class AllocationsRepository extends BaseRepository {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getByBookingId(bookingId: string): Promise<AllocationLookupItem | null> {
    return this.get<AllocationLookupItem>(this.getTableName(), {
      PK: AvailabilityKeyBuilder.allocationLookupPk(bookingId),
      SK: AvailabilityKeyBuilder.allocationLookupSk(),
    });
  }

  async getCanonical(
    canonicalPk: string,
    canonicalSk: string,
  ): Promise<AllocationItem | null> {
    return this.get<AllocationItem>(this.getTableName(), {
      PK: canonicalPk,
      SK: canonicalSk,
    });
  }

  async listForDate(
    vendorId: string,
    branchId: string,
    date: string,
  ): Promise<AllocationItem[]> {
    return this.queryAll<AllocationItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': AvailabilityKeyBuilder.dailyPk(vendorId, branchId, date),
        ':prefix': 'ALLOCATION#',
      },
    });
  }

  async consumeHold(input: {
    hold: HoldItem;
    lookup: HoldLookupItem;
    slotKey: { PK: string; SK: string };
    allocation: AllocationItem;
    allocationLookup: AllocationLookupItem;
    now: string;
    ttl: number;
  }): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Update: {
            TableName: this.getTableName(),
            Key: { PK: input.hold.PK, SK: input.hold.SK },
            UpdateExpression:
              'SET #status = :consumed, bookingId = :bookingId, updatedAt = :now, #ttl = :ttl REMOVE GSI1PK, GSI1SK',
            ConditionExpression: '#status = :active AND expiresAt > :now',
            ExpressionAttributeNames: { '#status': 'status', '#ttl': 'ttl' },
            ExpressionAttributeValues: {
              ':active': 'active',
              ':consumed': 'consumed',
              ':bookingId': input.allocation.bookingId,
              ':now': input.now,
              ':ttl': input.ttl,
            },
          },
        },
        {
          Update: {
            TableName: this.getTableName(),
            Key: { PK: input.lookup.PK, SK: input.lookup.SK },
            UpdateExpression:
              'SET #status = :consumed, bookingId = :bookingId, updatedAt = :now',
            ConditionExpression: '#status = :active',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':active': 'active',
              ':consumed': 'consumed',
              ':bookingId': input.allocation.bookingId,
              ':now': input.now,
            },
          },
        },
        {
          Update: {
            TableName: this.getTableName(),
            Key: input.slotKey,
            UpdateExpression:
              'SET heldCount = heldCount - :units, bookedCount = bookedCount + :units, updatedAt = :now',
            ConditionExpression: 'attribute_exists(PK) AND heldCount >= :units',
            ExpressionAttributeValues: {
              ':units': input.hold.units,
              ':now': input.now,
            },
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: input.allocation,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: input.allocationLookup,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    });
  }

  async releaseAllocation(input: {
    allocation: AllocationItem;
    lookup: AllocationLookupItem;
    slotKey: { PK: string; SK: string };
    now: string;
  }): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Update: {
            TableName: this.getTableName(),
            Key: { PK: input.allocation.PK, SK: input.allocation.SK },
            UpdateExpression: 'SET #status = :released, updatedAt = :now',
            ConditionExpression: '#status = :confirmed',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':confirmed': 'confirmed',
              ':released': 'released',
              ':now': input.now,
            },
          },
        },
        {
          Update: {
            TableName: this.getTableName(),
            Key: { PK: input.lookup.PK, SK: input.lookup.SK },
            UpdateExpression: 'SET #status = :released, updatedAt = :now',
            ConditionExpression: '#status = :confirmed',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':confirmed': 'confirmed',
              ':released': 'released',
              ':now': input.now,
            },
          },
        },
        {
          Update: {
            TableName: this.getTableName(),
            Key: input.slotKey,
            UpdateExpression: 'SET bookedCount = bookedCount - :units, updatedAt = :now',
            ConditionExpression: 'attribute_exists(PK) AND bookedCount >= :units',
            ExpressionAttributeValues: {
              ':units': input.allocation.units,
              ':now': input.now,
            },
          },
        },
      ],
    });
  }
}

let repository: AllocationsRepository;

export function getAllocationsRepository(): AllocationsRepository {
  if (!repository) {
    repository = new AllocationsRepository();
  }
  return repository;
}
