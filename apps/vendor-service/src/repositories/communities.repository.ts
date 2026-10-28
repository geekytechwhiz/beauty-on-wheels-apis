import { BaseRepository } from '@api-hub/utils';
import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import { VendorStatus } from '../types/api-types';
import { VendorCommunityDdbItem } from '../types/repository.types';
import {
  GSI3_INDEX,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';
import { normalize } from '../utils/helpers/vendor-request';

export interface CommunityPageResult {
  items: VendorCommunityDdbItem[];
  lastEvaluatedKey?: Record<string, unknown>;
}
export interface CommunityDirectoryItem {
  PK: string;
  SK: string;
  communityId: string;
  name: string;
  cityId: string;
  cityName: string;
  localityId?: string | null;
  localityName?: string | null;
  postalCode?: string | null;
  directoryStatus: 'ACTIVE';
  searchText: string;
}

export interface ListCommunitiesParams {
  cityId?: string;
  localityId?: string;
  postalCode?: string;
  search?: string;
  limit?: number;
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface CommunityDirectoryPageResult {
  items: CommunityDirectoryItem[];
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

  /** Canonical directory records are replicated locally as COMMUNITY#{id}/META. */
  async getActiveCommunity(communityId: string): Promise<CommunityDirectoryItem | null> {
    const item = await this.get<CommunityDirectoryItem>(this.getTableName(), {
      PK: `COMMUNITY#${communityId}`,
      SK: 'META',
    });
    return item?.directoryStatus === 'ACTIVE' ? item : null;
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
  async listCommunities(
    params: ListCommunitiesParams = {},
  ): Promise<CommunityDirectoryPageResult> {
    const {
      cityId,
      localityId,
      postalCode,
      search,
      limit = 20,
      lastEvaluatedKey,
    } = params;

    if (
      cityId !== undefined &&
      (typeof cityId !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(cityId))
    ) {
      throw new Error('Invalid cityId');
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be between 1 and 100');
    }

    if (
      localityId !== undefined &&
      (typeof localityId !== 'string' ||
        !/^[A-Z][A-Z0-9_]{0,149}$/.test(localityId))
    ) {
      throw new Error('Invalid localityId');
    }

    if (
      postalCode !== undefined &&
      (typeof postalCode !== 'string' || !/^[1-9]\d{5}$/.test(postalCode))
    ) {
      throw new Error('Invalid postalCode');
    }

    let normalizedSearch: string | undefined;

    if (search !== undefined) {
      if (typeof search !== 'string' || search.length > 100) {
        throw new Error('search must be a string of at most 100 characters');
      }

      normalizedSearch = normalize(search);

      if (!normalizedSearch) {
        throw new Error('search must contain searchable characters');
      }
    }

    // Use the most specific supplied filter.
    const partitionKey = postalCode
      ? `COMMUNITY_PIN#IN#${postalCode}#STATUS#ACTIVE`
      : localityId
        ? `COMMUNITY_LOCALITY#${localityId}#STATUS#ACTIVE`
        : cityId
          ? `COMMUNITY_CITY#${cityId}#STATUS#ACTIVE`
          : 'COMMUNITY_ALL#STATUS#ACTIVE';

    if (
      lastEvaluatedKey !== undefined &&
      (lastEvaluatedKey === null ||
        typeof lastEvaluatedKey !== 'object' ||
        Array.isArray(lastEvaluatedKey) ||
        Object.keys(lastEvaluatedKey).sort().join(',') !== 'PK,SK' ||
        lastEvaluatedKey.PK !== partitionKey ||
        typeof lastEvaluatedKey.SK !== 'string' ||
        !lastEvaluatedKey.SK.startsWith('NAME#'))
    ) {
      throw new Error('Invalid pagination cursor');
    }

    const names: NonNullable<QueryCommandInput['ExpressionAttributeNames']> = {
      '#pk': 'PK',
    };

    const values: NonNullable<QueryCommandInput['ExpressionAttributeValues']> =
      {
        ':pk': partitionKey,
      };

    const filters: string[] = [];

    // When querying PIN or locality, also enforce the supplied city.
    if (cityId && (postalCode || localityId)) {
      names['#cityId'] = 'cityId';
      values[':cityId'] = cityId;
      filters.push('#cityId = :cityId');
    }

    // When querying PIN, also enforce the supplied locality.
    if (postalCode && localityId) {
      names['#localityId'] = 'localityId';
      values[':localityId'] = localityId;
      filters.push('#localityId = :localityId');
    }

    if (normalizedSearch) {
      names['#searchText'] = 'searchText';
      values[':search'] = normalizedSearch;
      filters.push('contains(#searchText, :search)');
    }

    const queryParams: QueryCommandInput = {
      TableName: this.getTableName(),
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      Limit: limit,
      ConsistentRead: true,
      ...(filters.length > 0
        ? { FilterExpression: filters.join(' AND ') }
        : {}),
      ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
    };

    return this.queryPage<CommunityDirectoryItem>(queryParams);
  }
}

let repository: CommunitiesRepository;

export function getCommunitiesRepository() {
  if (!repository) {
    repository = new CommunitiesRepository();
  }
  return repository;
}
