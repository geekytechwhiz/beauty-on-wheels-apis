import { BaseRepository } from '@api-hub/utils';
import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import { CrewStatus } from '../types/api-types';
import { CrewDdbItem } from '../types/repository.types';
import { VendorKeyBuilder } from '../utils/constants/vendor-key-builder';

export interface CrewListQueryParams {
  vendorId: string;
  status?: CrewStatus;
  limit?: number;
  lastEvaluatedKey?: Record<string, unknown>;
}

export type CrewPageResult = {
  items: CrewDdbItem[];
  lastEvaluatedKey?: Record<string, unknown>;
};

export class CrewRepository extends BaseRepository {
  public getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async createCrew(item: CrewDdbItem): Promise<void> {
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
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
      ],
    });
  }

  async getCrew(vendorId: string, crewId: string): Promise<CrewDdbItem | null> {
    return this.get<CrewDdbItem>(this.getTableName(), {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.crewSk(crewId),
    });
  }

  async listCrews(params: CrewListQueryParams): Promise<CrewPageResult> {
    const queryParams: QueryCommandInput = {
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': VendorKeyBuilder.vendorPk(params.vendorId),
        ':skPrefix': VendorKeyBuilder.crewSkPrefix(),
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

    return this.queryPage<CrewDdbItem>(queryParams);
  }

  async listAllCrews(vendorId: string): Promise<CrewDdbItem[]> {
    return this.queryAll<CrewDdbItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': VendorKeyBuilder.vendorPk(vendorId),
        ':skPrefix': VendorKeyBuilder.crewSkPrefix(),
      },
    });
  }

  async updateCrew(item: CrewDdbItem, expectedRevision: number): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: {
              ...item,
              revision: expectedRevision + 1,
            },
            ConditionExpression:
              'attribute_exists(PK) AND attribute_exists(SK) AND revision = :expected',
            ExpressionAttributeValues: {
              ':expected': expectedRevision,
            },
          },
        },
      ],
    });
  }
}

let repository: CrewRepository;

export function getCrewRepository() {
  if (!repository) {
    repository = new CrewRepository();
  }
  return repository;
}
