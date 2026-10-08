jest.mock('../configs/env.config', () => ({
  env: {
    DYNAMODB_TABLE_NAME: 'catalog-test',
    SERVICE_NAME: 'service-catalog-service',
    LOG_LEVEL: 'info',
    EVENT_BUS_NAME: '',
    VENDOR_SERVICE_URL: '',
  },
}));

import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

import { PackagesRepository } from './packages.repository';

class ProbePackagesRepository extends PackagesRepository {
  queries: QueryCommandInput[] = [];

  protected override async queryPage<T>(
    params: QueryCommandInput,
  ): Promise<{ items: T[]; lastEvaluatedKey?: Record<string, unknown> }> {
    this.queries.push(params);
    return {
      items: [] as T[],
      lastEvaluatedKey: { PK: 'CATALOG#PACKAGES', SK: 'META#PACKAGE#pkg-1' },
    };
  }
}

describe('PackagesRepository.listPackages', () => {
  it('queries the base table by package sort key, not LSI3', async () => {
    const repository = new ProbePackagesRepository();

    const page = await repository.listPackages({
      limit: 10,
      lastEvaluatedKey: { PK: 'CATALOG#PACKAGES', SK: 'META#PACKAGE#prev' },
    });

    expect(repository.queries[0].IndexName).toBeUndefined();
    expect(repository.queries[0].KeyConditionExpression).toBe(
      '#pk = :pk AND begins_with(#sk, :skPrefix)',
    );
    expect(repository.queries[0].ExpressionAttributeValues).toEqual({
      ':pk': 'CATALOG#PACKAGES',
      ':skPrefix': 'META#PACKAGE#',
    });
    expect(repository.queries[0].Limit).toBe(10);
    expect(page.lastEvaluatedKey).toEqual({
      PK: 'CATALOG#PACKAGES',
      SK: 'META#PACKAGE#pkg-1',
    });
  });

  it('filters active packages on LSI2', async () => {
    const repository = new ProbePackagesRepository();

    await repository.listPackages({ activeOnly: true, limit: 5 });

    expect(repository.queries[0].IndexName).toBe('LSI2');
    expect(repository.queries[0].KeyConditionExpression).toBe(
      '#pk = :pk AND #lsi2sk = :lsi2sk',
    );
    expect(repository.queries[0].ExpressionAttributeValues).toEqual({
      ':pk': 'CATALOG#PACKAGES',
      ':lsi2sk': 'ACTIVE#1',
    });
  });
});
