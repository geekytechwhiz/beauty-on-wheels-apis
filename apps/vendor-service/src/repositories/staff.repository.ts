import { BaseRepository } from '@api-hub/utils';
import { QueryCommandInput, TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import { indianMobilesMatch } from '../domain/indian-mobile';
import { StaffStatus } from '../types/api-types';
import { StaffDdbItem, StaffPhoneDdbItem } from '../types/repository.types';
import {
  STAFF_PHONE_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

export interface StaffListQueryParams {
  vendorId: string;
  status?: StaffStatus;
  limit?: number;
  lastEvaluatedKey?: Record<string, unknown>;
}

export type StaffPageResult = {
  items: StaffDdbItem[];
  lastEvaluatedKey?: Record<string, unknown>;
};

export class StaffRepository extends BaseRepository {
  constructor() {
    super();
  }

  public getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async createStaff(item: StaffDdbItem): Promise<void> {
    const membership = this.membershipItem(item);
    await this.transactWrite({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: this.getTableName(),
            Key: {
              PK: VendorKeyBuilder.vendorPk(item.vendorId),
              SK: VendorKeyBuilder.vendorSk(),
            },
            ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression:
              'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: this.phoneItem(item),
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        ...(membership ? [{
          Put: {
            TableName: this.getTableName(),
            Item: membership,
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        }] : []),
      ],
    });
  }

  async getStaff(vendorId: string, staffId: string): Promise<StaffDdbItem | null> {
    return this.get<StaffDdbItem>(this.getTableName(), {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.staffSk(staffId),
    });
  }

  async listStaff(params: StaffListQueryParams): Promise<StaffPageResult> {
    const queryParams: QueryCommandInput = {
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': VendorKeyBuilder.vendorPk(params.vendorId),
        ':skPrefix': VendorKeyBuilder.staffSkPrefix(),
      },
      Limit: params.limit,
      ExclusiveStartKey: params.lastEvaluatedKey,
    };

    if (params.status) {
      queryParams.FilterExpression = '#status = :status';
      queryParams.ExpressionAttributeNames = { '#status': 'status' };
      queryParams.ExpressionAttributeValues = {
        ...queryParams.ExpressionAttributeValues,
        ':status': params.status,
      };
    }

    return this.queryPage<StaffDdbItem>(queryParams);
  }

  async findStaffByUserId(
    vendorId: string,
    userId: string,
  ): Promise<StaffDdbItem | null> {
    const queryParams: QueryCommandInput = {
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':pk': VendorKeyBuilder.vendorPk(vendorId),
        ':skPrefix': VendorKeyBuilder.staffSkPrefix(),
        ':userId': userId,
      },
    };

    return this.queryOne<StaffDdbItem>(queryParams);
  }

  async updateStaff(
    item: StaffDdbItem,
    options?: { previousPhone?: string; releasePhone?: boolean },
  ): Promise<void> {
    const membership = this.membershipItem(item);
    await this.transactWrite({
      TransactItems: [
        ...this.phoneChanges(item, options),
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          },
        },
        ...(membership ? [{
          Put: {
            TableName: this.getTableName(),
            Item: membership,
          },
        }] : []),
      ],
    });
  }

  async listAllStaff(vendorId: string): Promise<StaffDdbItem[]> {
    return this.queryAll<StaffDdbItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': VendorKeyBuilder.vendorPk(vendorId),
        ':skPrefix': VendorKeyBuilder.staffSkPrefix(),
      },
    });
  }

  async findStaffByPhone(
    vendorId: string,
    phoneNumber: string,
  ): Promise<StaffDdbItem | null> {
    const lock = await this.get<StaffPhoneDdbItem>(this.getTableName(), {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.staffPhoneSk(phoneNumber),
    });
    if (lock?.staffId) {
      const linked = await this.getStaff(vendorId, lock.staffId);
      if (linked) return linked;
    }

    const items = await this.listAllStaff(vendorId);
    return items.find((item) => (
      item.status !== 'INACTIVE' && indianMobilesMatch(item.phoneNumber, phoneNumber)
    )) ?? null;
  }

  async listMembershipsByUserId(userId: string): Promise<StaffMembershipItem[]> {
    const result = await this.queryAll<StaffMembershipItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `STAFF_USER#${userId}`,
        ':prefix': 'VENDOR#',
      },
    });
    return result;
  }

  private phoneItem(item: StaffDdbItem): StaffPhoneDdbItem {
    return {
      PK: VendorKeyBuilder.vendorPk(item.vendorId),
      SK: VendorKeyBuilder.staffPhoneSk(item.phoneNumber),
      vendorId: item.vendorId,
      staffId: item.staffId,
      phoneNumber: item.phoneNumber,
      entityType: STAFF_PHONE_ENTITY_TYPE,
    };
  }

  private phoneChanges(
    item: StaffDdbItem,
    options?: { previousPhone?: string; releasePhone?: boolean },
  ): NonNullable<TransactWriteCommandInput['TransactItems']> {
    if (options?.releasePhone) {
      const phones = new Set(
        [item.phoneNumber, options.previousPhone].filter((phone): phone is string => Boolean(phone)),
      );
      return [...phones].map((phoneNumber) => ({
        Delete: {
          TableName: this.getTableName(),
          Key: {
            PK: VendorKeyBuilder.vendorPk(item.vendorId),
            SK: VendorKeyBuilder.staffPhoneSk(phoneNumber),
          },
        },
      }));
    }
    if (!options?.previousPhone || options.previousPhone === item.phoneNumber) {
      return [];
    }
    return [
      {
        Put: {
          TableName: this.getTableName(),
          Item: this.phoneItem(item),
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
      {
        Delete: {
          TableName: this.getTableName(),
          Key: {
            PK: VendorKeyBuilder.vendorPk(item.vendorId),
            SK: VendorKeyBuilder.staffPhoneSk(options.previousPhone),
          },
        },
      },
    ];
  }

  private membershipItem(item: StaffDdbItem): StaffMembershipItem | undefined {
    const userId = item.userId?.trim();
    if (!userId) return undefined;
    return {
      PK: `STAFF_USER#${userId}`,
      SK: `VENDOR#${item.vendorId}`,
      userId,
      vendorId: item.vendorId,
      staffId: item.staffId,
      status: item.status,
      entityType: 'StaffMembership',
    };
  }
}

export interface StaffMembershipItem {
  PK: string;
  SK: string;
  userId: string;
  vendorId: string;
  staffId: string;
  status: StaffStatus;
  entityType: 'StaffMembership';
}

let repository: StaffRepository;

export function getStaffRepository() {
  if (!repository) {
    repository = new StaffRepository();
  }

  return repository;
}
