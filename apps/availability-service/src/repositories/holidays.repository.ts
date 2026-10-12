import { BaseRepository } from '@api-hub/utils';
import { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import { AvailabilityKeyBuilder } from '../domain/keys';
import { HolidayItem, HolidayLookupItem } from '../types/records';

export class HolidaysRepository extends BaseRepository {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getLookup(holidayId: string): Promise<HolidayLookupItem | null> {
    return this.get<HolidayLookupItem>(this.getTableName(), {
      PK: AvailabilityKeyBuilder.holidayLookupPk(holidayId),
      SK: 'META',
    });
  }

  async getCanonical(canonicalPk: string, canonicalSk: string): Promise<HolidayItem | null> {
    return this.get<HolidayItem>(this.getTableName(), {
      PK: canonicalPk,
      SK: canonicalSk,
    });
  }

  async createHoliday(input: {
    holiday: HolidayItem;
    index: HolidayItem;
    lookup: HolidayLookupItem;
  }): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: input.holiday,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: input.index,
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

  async replaceHoliday(input: {
    previousPk: string;
    previousSk: string;
    previousIndexPk: string;
    previousIndexSk: string;
    holiday: HolidayItem;
    index: HolidayItem;
    lookup: HolidayLookupItem;
  }): Promise<void> {
    const sameCanonical =
      input.previousPk === input.holiday.PK && input.previousSk === input.holiday.SK;
    const values: Record<string, unknown> = {
      ':pk': input.holiday.PK,
      ':sk': input.holiday.SK,
      ':indexPk': input.index.PK,
      ':indexSk': input.index.SK,
      ':date': input.holiday.date,
      ':holidayName': input.holiday.holidayName ?? '',
      ':now': input.holiday.updatedAt,
    };
    if (input.holiday.branchId) {
      values[':branchId'] = input.holiday.branchId;
    }
    const items: NonNullable<TransactWriteCommandInput['TransactItems']> = [
      {
        Update: {
          TableName: this.getTableName(),
          Key: { PK: input.lookup.PK, SK: input.lookup.SK },
          UpdateExpression: input.holiday.branchId
            ? 'SET canonicalPk = :pk, canonicalSk = :sk, indexPk = :indexPk, indexSk = :indexSk, #date = :date, holidayName = :holidayName, updatedAt = :now, branchId = :branchId'
            : 'SET canonicalPk = :pk, canonicalSk = :sk, indexPk = :indexPk, indexSk = :indexSk, #date = :date, holidayName = :holidayName, updatedAt = :now REMOVE branchId',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#date': 'date' },
          ExpressionAttributeValues: values,
        },
      },
    ];

    if (sameCanonical) {
      items.push({
        Put: {
          TableName: this.getTableName(),
          Item: input.holiday,
          ConditionExpression: 'attribute_exists(PK)',
        },
      });
      items.push({
        Put: {
          TableName: this.getTableName(),
          Item: input.index,
        },
      });
    } else {
      items.push(
        {
          Delete: {
            TableName: this.getTableName(),
            Key: { PK: input.previousPk, SK: input.previousSk },
            ConditionExpression: 'attribute_exists(PK)',
          },
        },
        {
          Delete: {
            TableName: this.getTableName(),
            Key: { PK: input.previousIndexPk, SK: input.previousIndexSk },
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: input.holiday,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: input.index,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      );
    }

    await this.transactWrite({ TransactItems: items });
  }

  async deleteHoliday(lookup: HolidayLookupItem): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Delete: {
            TableName: this.getTableName(),
            Key: { PK: lookup.canonicalPk, SK: lookup.canonicalSk },
            ConditionExpression: 'attribute_exists(PK)',
          },
        },
        {
          Delete: {
            TableName: this.getTableName(),
            Key: { PK: lookup.indexPk, SK: lookup.indexSk },
          },
        },
        {
          Delete: {
            TableName: this.getTableName(),
            Key: { PK: lookup.PK, SK: lookup.SK },
            ConditionExpression: 'attribute_exists(PK)',
          },
        },
      ],
    });
  }

  async listBranchHolidays(vendorId: string, branchId: string): Promise<HolidayItem[]> {
    return this.queryAll<HolidayItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': AvailabilityKeyBuilder.branchHolidayPk(vendorId, branchId),
        ':prefix': 'HOLIDAY#',
      },
    });
  }

  async listVendorHolidays(vendorId: string): Promise<HolidayItem[]> {
    return this.queryAll<HolidayItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': AvailabilityKeyBuilder.vendorHolidayPk(vendorId),
        ':prefix': 'HOLIDAY#',
      },
    });
  }

  async listAllHolidays(vendorId: string): Promise<HolidayItem[]> {
    return this.queryAll<HolidayItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': AvailabilityKeyBuilder.holidayIndexPk(vendorId),
        ':prefix': 'HOLIDAY#',
      },
    });
  }
}

let repository: HolidaysRepository;

export function getHolidaysRepository(): HolidaysRepository {
  if (!repository) {
    repository = new HolidaysRepository();
  }
  return repository;
}
