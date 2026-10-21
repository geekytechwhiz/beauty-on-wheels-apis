jest.mock('../configs/env.config', () => ({
  env: {
    DYNAMODB_TABLE_NAME: 'catalog-test',
    SERVICE_NAME: 'service-catalog-service',
    LOG_LEVEL: 'info',
    EVENT_BUS_NAME: '',
    VENDOR_PRICING_CONFIGURATION_FUNCTION: '',
    VENDOR_DISCOVERY_FACTS_FUNCTION: '',
    AVAILABILITY_BOOKABLE_FUNCTION: '',
  },
}));

import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

import { ServiceDiscoveryEntity } from '../types/service-discovery.types';
import { OfferingsRepository } from './offerings.repository';

class ProbeOfferingsRepository extends OfferingsRepository {
  queries: QueryCommandInput[] = [];
  private remainingPages = 0;

  constructor(private readonly mode: 'one' | 'truncated') {
    super();
  }

  protected override async queryPage<T>(
    params: QueryCommandInput,
  ): Promise<{ items: T[]; lastEvaluatedKey?: Record<string, unknown> }> {
    this.queries.push(params);
    if (this.mode === 'one') {
      return {
        items: [
          discovery('svc-1'),
          { entityType: 'OTHER' },
        ] as T[],
      };
    }
    this.remainingPages += 1;
    return {
      items: Array.from({ length: params.Limit ?? 1 }, () => discovery(`svc-${this.remainingPages}`)) as T[],
      lastEvaluatedKey: { PK: 'more' },
    };
  }
}

function discovery(serviceId: string): ServiceDiscoveryEntity {
  return {
    PK: 'DISCOVERY#ALL',
    SK: `SERVICE#${serviceId}#BRANCH#branch-1`,
    entityType: 'SERVICE_DISCOVERY',
    GSI2PK: 'DISCOVERY#ALL',
    GSI2SK: `SERVICE#${serviceId}#BRANCH#branch-1`,
    serviceId,
    vendorId: 'vendor-1',
    branchId: 'branch-1',
    categoryId: 'cat-1',
    name: serviceId,
    normalizedName: serviceId,
    searchText: serviceId,
    durationMinutes: 30,
    vehicleTypes: ['SUV'],
    displayPricesByVehicleType: { SUV: 100 },
    basePrice: 100,
    currency: 'INR',
    active: true,
    vendorApproved: true,
    branchOperational: true,
    serviceUpdatedAt: '2026-10-01T00:00:00.000Z',
    vendorReviewedAt: '2026-10-01T00:00:00.000Z',
    branchUpdatedAt: '2026-10-01T00:00:00.000Z',
    priceUpdatedAt: '2026-10-01T00:00:00.000Z',
  };
}

describe('OfferingsRepository', () => {
  it('queries GSI2 for the discovery partition and does not scan or filter', async () => {
    const repository = new ProbeOfferingsRepository('one');
    const page = await repository.listDiscoveryPartition('DISCOVERY#CATEGORY#cat-1');

    expect(page.truncated).toBe(false);
    expect(page.items).toHaveLength(1);
    expect(repository.queries).toHaveLength(1);
    expect(repository.queries[0]).toMatchObject({
      TableName: 'catalog-test',
      IndexName: 'GSI2',
      KeyConditionExpression: '#gpk = :gpk',
      ExpressionAttributeValues: { ':gpk': 'DISCOVERY#CATEGORY#cat-1' },
    });
    expect(repository.queries[0].FilterExpression).toBeUndefined();
    expect(JSON.stringify(repository.queries[0])).not.toContain('Scan');
  });

  it('stops when the candidate cap is exceeded instead of reading forever', async () => {
    const repository = new ProbeOfferingsRepository('truncated');
    const page = await repository.listDiscoveryPartition('DISCOVERY#ALL');

    expect(page).toEqual({ items: [], truncated: true });
    expect(repository.queries.length).toBeLessThan(20);
    expect(repository.queries.length).toBeGreaterThan(1);
  });
});
