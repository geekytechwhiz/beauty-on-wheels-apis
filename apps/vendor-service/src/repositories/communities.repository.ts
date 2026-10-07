import { BaseRepository } from '@api-hub/utils';
import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import { VendorStatus } from '../types/api-types';
import { VendorCommunityDdbItem } from '../types/repository.types';
import {
  GSI3_INDEX,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

export interface CommunityPageResult {
  items: VendorCommunityDdbItem[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export class CommunitiesRepository extends BaseRepository {
  public getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async listByVendor(vendorId: string): Promise<VendorCommunityDdbItem[]> {
    return this.queryAll<VendorCommunityDdbItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': VendorKeyBuilder.vendorPk(vendorId),
        ':sk': VendorKeyBuilder.communitySkPrefix(),
      },
    });
  }

  async listByCommunity(params: {
    communityId: string;
    status?: VendorStatus;
    limit?: number;
    lastEvaluatedKey?: Record<string, unknown>;
    operationalStatus?: string;
  }): Promise<CommunityPageResult> {
    const queryParams: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: GSI3_INDEX,
      Limit: params.limit,
      ExclusiveStartKey: params.lastEvaluatedKey,
      ExpressionAttributeValues: {
        ':gsi3pk': VendorKeyBuilder.communityGsi3Pk(params.communityId),
      },
    };

    if (params.status) {
      queryParams.KeyConditionExpression =
        'GSI3PK = :gsi3pk AND begins_with(GSI3SK, :gsi3sk)';
      queryParams.ExpressionAttributeValues = {
        ...queryParams.ExpressionAttributeValues,
        ':gsi3sk': VendorKeyBuilder.communityGsi3StatusPrefix(params.status),
      };
    } else {
      queryParams.KeyConditionExpression = 'GSI3PK = :gsi3pk';
    }

    if (params.operationalStatus) {
      queryParams.FilterExpression = 'operationalStatus = :operationalStatus';
      queryParams.ExpressionAttributeValues = {
        ...queryParams.ExpressionAttributeValues,
        ':operationalStatus': params.operationalStatus,
      };
    }

    return this.queryPage<VendorCommunityDdbItem>(queryParams);
  }
}

let repository: CommunitiesRepository;

export function getCommunitiesRepository() {
  if (!repository) {
    repository = new CommunitiesRepository();
  }
  return repository;
}
