import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import { ServiceDiscoveryEntity } from '../types/service-discovery.types';
import {
  DISCOVERY_INDEX_NAME,
  OFFERING_CANDIDATE_LIMIT,
} from './types';

const PAGE_LIMIT = 500;

export interface DiscoveryPartitionPage {
  items: ServiceDiscoveryEntity[];
  truncated: boolean;
}

export class OfferingsRepository extends BaseRepository {
  /**
   * Reads one discovery partition from GSI2.
   * The partition is either DISCOVERY#ALL or DISCOVERY#CATEGORY#<categoryId>.
   * Stops once the candidate cap is exceeded and reports truncation.
   * It does not filter, sort, or scan.
   */
  async listDiscoveryPartition(partitionKey: string): Promise<DiscoveryPartitionPage> {
    const items: ServiceDiscoveryEntity[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const remaining = OFFERING_CANDIDATE_LIMIT + 1 - items.length;
      const page = await this.queryPage<ServiceDiscoveryEntity>({
        TableName: env.DYNAMODB_TABLE_NAME,
        IndexName: DISCOVERY_INDEX_NAME,
        KeyConditionExpression: '#gpk = :gpk',
        ExpressionAttributeNames: { '#gpk': 'GSI2PK' },
        ExpressionAttributeValues: { ':gpk': partitionKey },
        Limit: Math.min(PAGE_LIMIT, remaining),
        ExclusiveStartKey: lastEvaluatedKey,
      });
      items.push(...page.items);
      lastEvaluatedKey = page.lastEvaluatedKey;
    } while (lastEvaluatedKey && items.length <= OFFERING_CANDIDATE_LIMIT);

    if (items.length > OFFERING_CANDIDATE_LIMIT || lastEvaluatedKey) {
      return { items: [], truncated: true };
    }

    return {
      items: items.filter((item) => item.entityType === 'SERVICE_DISCOVERY'),
      truncated: false,
    };
  }
}

let repository: OfferingsRepository | undefined;

export function getOfferingsRepository(): OfferingsRepository {
  if (!repository) {
    repository = new OfferingsRepository();
  }
  return repository;
}
