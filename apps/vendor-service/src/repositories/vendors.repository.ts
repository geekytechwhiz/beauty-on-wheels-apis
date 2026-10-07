import { BaseRepository } from '@api-hub/utils';
import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import { OperationalStatus, VendorStatus } from '../types/api-types';
import {
  VendorAddressDdbItem,
  VendorBankDdbItem,
  VendorChildDdbItem,
  VendorCommunityDdbItem,
  VendorDdbItem,
  VendorOwnerDdbItem,
  VendorStatusHistoryDdbItem,
} from '../types/repository.types';
import {
  GSI1_INDEX,
  GSI2_INDEX,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

export interface VendorListQueryParams {
  status?: VendorStatus;
  operationalStatus?: OperationalStatus;
  limit?: number;
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface VendorCityListQueryParams {
  city: string;
  postalCode?: string;
  limit?: number;
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface VendorPostalListQueryParams {
  postalCode: string;
  limit?: number;
  lastEvaluatedKey?: Record<string, unknown>;
}

export type VendorPageResult = {
  items: VendorDdbItem[];
  lastEvaluatedKey?: Record<string, unknown>;
};

export class VendorsRepository extends BaseRepository {
  constructor() {
    super();
  }

  public getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async createVendor(
    profile: VendorDdbItem,
    owner: VendorOwnerDdbItem,
  ): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: profile,
            ConditionExpression:
              'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: owner,
            ConditionExpression:
              'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
      ],
    });
  }

  async getVendorById(vendorId: string): Promise<VendorDdbItem | null> {
    return this.get<VendorDdbItem>(this.getTableName(), {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.vendorSk(),
    });
  }

  async getOwner(vendorId: string): Promise<VendorOwnerDdbItem | null> {
    return this.get<VendorOwnerDdbItem>(this.getTableName(), {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.ownerSk(),
    });
  }

  async getAddress(vendorId: string): Promise<VendorAddressDdbItem | null> {
    return this.get<VendorAddressDdbItem>(this.getTableName(), {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.addressSk(),
    });
  }

  async getBank(vendorId: string): Promise<VendorBankDdbItem | null> {
    return this.get<VendorBankDdbItem>(this.getTableName(), {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.bankSk(),
    });
  }

  async getVendorIdByOwnerUserId(userId: string): Promise<string | null> {
    const item = await this.queryOne<VendorOwnerDdbItem>({
      TableName: this.getTableName(),
      IndexName: GSI1_INDEX,
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': VendorKeyBuilder.ownerGsi1Pk(userId),
      },
    });

    return item?.vendorId ?? null;
  }

  async queryVendorItems(vendorId: string): Promise<VendorChildDdbItem[]> {
    return this.queryAll<VendorChildDdbItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': VendorKeyBuilder.vendorPk(vendorId),
      },
    });
  }

  async updateVendor(item: VendorDdbItem): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression:
              'attribute_exists(PK) AND attribute_exists(SK)',
          },
        },
      ],
    });
  }

  async putSection(
    profile: VendorDdbItem,
    sectionItem?: Record<string, unknown>,
  ): Promise<void> {
    const transactItems: Array<Record<string, unknown>> = [
      {
        Put: {
          TableName: this.getTableName(),
          Item: profile,
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
        },
      },
    ];

    if (sectionItem) {
      transactItems.push({
        Put: {
          TableName: this.getTableName(),
          Item: sectionItem,
        },
      });
    }

    await this.transactWrite({
      TransactItems: transactItems as never,
    });
  }

  async listVendors(params: VendorListQueryParams = {}): Promise<VendorPageResult> {
    const queryParams: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: GSI1_INDEX,
      Limit: params.limit,
      ExclusiveStartKey: params.lastEvaluatedKey,
    };

    if (params.status && params.operationalStatus) {
      queryParams.KeyConditionExpression =
        'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :gsi1skPrefix)';
      queryParams.ExpressionAttributeValues = {
        ':gsi1pk': VendorKeyBuilder.gsi1Pk(),
        ':gsi1skPrefix': VendorKeyBuilder.gsi1SkStatusOperationalPrefix(
          params.status,
          params.operationalStatus,
        ),
      };
    } else if (params.status) {
      queryParams.KeyConditionExpression =
        'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :gsi1skPrefix)';
      queryParams.ExpressionAttributeValues = {
        ':gsi1pk': VendorKeyBuilder.gsi1Pk(),
        ':gsi1skPrefix': VendorKeyBuilder.gsi1SkStatusPrefix(params.status),
      };
    } else if (params.operationalStatus) {
      queryParams.KeyConditionExpression = 'GSI1PK = :gsi1pk';
      queryParams.FilterExpression = 'operationalStatus = :operationalStatus';
      queryParams.ExpressionAttributeValues = {
        ':gsi1pk': VendorKeyBuilder.gsi1Pk(),
        ':operationalStatus': params.operationalStatus,
      };
    } else {
      queryParams.KeyConditionExpression = 'GSI1PK = :gsi1pk';
      queryParams.ExpressionAttributeValues = {
        ':gsi1pk': VendorKeyBuilder.gsi1Pk(),
      };
    }

    return this.queryPage<VendorDdbItem>(queryParams);
  }

  async listVendorsByCity(
    params: VendorCityListQueryParams,
  ): Promise<VendorPageResult> {
    const queryParams: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: GSI2_INDEX,
      Limit: params.limit,
      ExclusiveStartKey: params.lastEvaluatedKey,
    };

    if (params.postalCode) {
      queryParams.KeyConditionExpression =
        'GSI2PK = :gsi2pk AND begins_with(GSI2SK, :gsi2skPrefix)';
      queryParams.ExpressionAttributeValues = {
        ':gsi2pk': VendorKeyBuilder.gsi2Pk(params.city),
        ':gsi2skPrefix': VendorKeyBuilder.gsi2SkPostalPrefix(params.postalCode),
      };
    } else {
      queryParams.KeyConditionExpression = 'GSI2PK = :gsi2pk';
      queryParams.ExpressionAttributeValues = {
        ':gsi2pk': VendorKeyBuilder.gsi2Pk(params.city),
      };
    }

    return this.queryPage<VendorDdbItem>(queryParams);
  }

  async listVendorsByPostalCode(
    params: VendorPostalListQueryParams,
  ): Promise<VendorPageResult> {
    const queryParams: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: GSI1_INDEX,
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      FilterExpression: 'addressPostalCode = :postalCode',
      ExpressionAttributeValues: {
        ':gsi1pk': VendorKeyBuilder.gsi1Pk(),
        ':postalCode': params.postalCode,
      },
      Limit: params.limit,
      ExclusiveStartKey: params.lastEvaluatedKey,
    };

    return this.queryPage<VendorDdbItem>(queryParams);
  }

  async getVendorsByIds(vendorIds: string[]): Promise<VendorDdbItem[]> {
    if (vendorIds.length === 0) {
      return [];
    }

    return this.batchGet<VendorDdbItem>({
      RequestItems: {
        [this.getTableName()]: {
          Keys: vendorIds.map((vendorId) => ({
            PK: VendorKeyBuilder.vendorPk(vendorId),
            SK: VendorKeyBuilder.vendorSk(),
          })),
        },
      },
    });
  }

  async listStatusHistory(
    vendorId: string,
    limit = 50,
  ): Promise<VendorStatusHistoryDdbItem[]> {
    const page = await this.queryPage<VendorStatusHistoryDdbItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': VendorKeyBuilder.vendorPk(vendorId),
        ':sk': VendorKeyBuilder.statusHistorySkPrefix(),
      },
      ScanIndexForward: false,
      Limit: limit,
    });
    return page.items;
  }

  async transactVendorProfile(input: {
    profile: VendorDdbItem;
    expectedUpdatedAt?: string;
    expectedStatus?: VendorStatus;
    puts?: Array<{
      item: Record<string, unknown> | VendorCommunityDdbItem | VendorStatusHistoryDdbItem;
      condition?: 'exists' | 'not_exists';
    }>;
    deletes?: Array<{ PK: string; SK: string }>;
  }): Promise<void> {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const conditions = ['attribute_exists(PK)', 'attribute_exists(SK)'];

    if (input.expectedStatus) {
      names['#status'] = 'status';
      values[':expectedStatus'] = input.expectedStatus;
      conditions.push('#status = :expectedStatus');
    }

    if (input.expectedUpdatedAt) {
      values[':expectedUpdatedAt'] = input.expectedUpdatedAt;
      conditions.push('updatedAt = :expectedUpdatedAt');
    }

    const profilePut: Record<string, unknown> = {
      TableName: this.getTableName(),
      Item: input.profile,
      ConditionExpression: conditions.join(' AND '),
    };
    if (Object.keys(names).length > 0) {
      profilePut.ExpressionAttributeNames = names;
    }
    if (Object.keys(values).length > 0) {
      profilePut.ExpressionAttributeValues = values;
    }

    const transactItems: Array<Record<string, unknown>> = [{ Put: profilePut }];

    for (const put of input.puts ?? []) {
      const entry: Record<string, unknown> = {
        TableName: this.getTableName(),
        Item: put.item,
      };
      if (put.condition === 'not_exists') {
        entry.ConditionExpression =
          'attribute_not_exists(PK) AND attribute_not_exists(SK)';
      } else if (put.condition === 'exists') {
        entry.ConditionExpression = 'attribute_exists(PK) AND attribute_exists(SK)';
      }
      transactItems.push({ Put: entry });
    }

    for (const key of input.deletes ?? []) {
      transactItems.push({
        Delete: {
          TableName: this.getTableName(),
          Key: key,
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
        },
      });
    }

    await this.transactWrite({
      TransactItems: transactItems as never,
    });
  }
}

let repository: VendorsRepository;

export function getVendorsRepository() {
  if (!repository) {
    repository = new VendorsRepository();
  }

  return repository;
}
