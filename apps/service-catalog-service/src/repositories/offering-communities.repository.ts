import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import {
  CATALOG_GSI3_INDEX,
  CatalogWrite,
  toTransactPuts,
} from '../domain/offering-community';
import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';
import {
  OfferingCommunityEntity,
  ServiceCreateIdempotencyEntity,
} from '../utils/types/catalog-domain.types';

export interface CommunityIndexPage {
  items: OfferingCommunityEntity[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export class OfferingCommunitiesRepository extends BaseRepository {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  /**
   * One TransactWrite. Callers must not chunk this list.
   * Discovery projections are written afterwards.
   */
  async commitWrites(writes: readonly CatalogWrite[]): Promise<void> {
    await this.transactWrite({
      TransactItems: toTransactPuts(this.getTableName(), writes) as never,
    });
  }

  async getIdempotency(
    vendorId: string,
    idempotencyKey: string,
  ): Promise<ServiceCreateIdempotencyEntity | null> {
    const item = await this.get<ServiceCreateIdempotencyEntity>(this.getTableName(), {
      PK: CatalogKeyBuilder.vendorPk(vendorId),
      SK: CatalogKeyBuilder.serviceIdempotencySk(idempotencyKey),
    }, { consistent: true });
    return item?.entityType === 'ServiceCreateIdempotency' ? item : null;
  }

  async getMapping(
    serviceId: string,
    communityId: string,
    consistent = false,
  ): Promise<OfferingCommunityEntity | null> {
    const item = await this.get<OfferingCommunityEntity>(this.getTableName(), {
      PK: CatalogKeyBuilder.serviceLookupPk(serviceId),
      SK: CatalogKeyBuilder.offeringCommunitySk(communityId),
    }, { consistent });
    return item?.entityType === 'OfferingCommunity' ? item : null;
  }

  async listByService(serviceId: string, consistent = false): Promise<OfferingCommunityEntity[]> {
    const items = await this.query<OfferingCommunityEntity>({
      TableName: this.getTableName(),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: {
        ':pk': CatalogKeyBuilder.serviceLookupPk(serviceId),
        ':prefix': CatalogKeyBuilder.offeringCommunityPrefix(),
      },
      ConsistentRead: consistent,
    });
    return items.filter((item) => item.entityType === 'OfferingCommunity');
  }

  async queryActivePage(input: {
    communityId: string;
    categoryId?: string;
    limit: number;
    exclusiveStartKey?: Record<string, unknown>;
    vendorId?: string;
  }): Promise<CommunityIndexPage> {
    const names: Record<string, string> = { '#pk': 'GSI3PK' };
    const values: Record<string, unknown> = {
      ':pk': CatalogKeyBuilder.communityGsi3Pk(input.communityId),
    };
    let keyCondition = '#pk = :pk';
    if (input.categoryId) {
      names['#sk'] = 'GSI3SK';
      values[':prefix'] = CatalogKeyBuilder.communityGsi3CategoryPrefix(input.categoryId);
      keyCondition += ' AND begins_with(#sk, :prefix)';
    }
    if (input.vendorId) {
      names['#vendorId'] = 'vendorId';
      values[':vendorId'] = input.vendorId;
    }
    const page = await this.queryPage<OfferingCommunityEntity>({
      TableName: this.getTableName(),
      IndexName: CATALOG_GSI3_INDEX,
      KeyConditionExpression: keyCondition,
      ...(input.vendorId ? { FilterExpression: '#vendorId = :vendorId' } : {}),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      Limit: input.limit,
      ExclusiveStartKey: input.exclusiveStartKey,
    });
    return {
      items: page.items.filter((item) => item.entityType === 'OfferingCommunity'),
      lastEvaluatedKey: page.lastEvaluatedKey,
    };
  }
}

let repository: OfferingCommunitiesRepository | undefined;

export function getOfferingCommunitiesRepository(): OfferingCommunitiesRepository {
  if (!repository) {
    repository = new OfferingCommunitiesRepository();
  }
  return repository;
}
