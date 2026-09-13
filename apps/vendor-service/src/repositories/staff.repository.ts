import { BaseRepository } from '@api-hub/utils';
import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import { StaffStatus } from '../types/api-types';
import { StaffDdbItem } from '../types/repository.types';
import { VendorKeyBuilder } from '../utils/constants/vendor-key-builder';

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

  async updateStaff(item: StaffDdbItem): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          },
        },
      ],
    });
  }
}

let repository: StaffRepository;

export function getStaffRepository() {
  if (!repository) {
    repository = new StaffRepository();
  }

  return repository;
}
