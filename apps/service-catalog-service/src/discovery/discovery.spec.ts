jest.mock('../configs/env.config', () => ({
  env: {
    DYNAMODB_TABLE_NAME: 'catalog-test',
    SERVICE_NAME: 'service-catalog-service',
    LOG_LEVEL: 'info',
    EVENT_BUS_NAME: '',
    VENDOR_SERVICE_URL: '',
  },
}));

import { ConditionalWriteConflictError, LambdaRequest } from '@api-hub/utils';
import { QueryCommandInput, TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

import { backfillDiscoveryProjections } from '../discovery/backfill-discovery-projections';
import {
  buildDiscoveryWritePlan,
  discoveryWriteBlocked,
} from '../domain/discovery-projection';
import { handler as backfillHandler } from '../handlers/backfill-discovery-handler';
import { ServicesRepository } from '../repositories/services.repository';
import { CategoriesRepository } from '../repositories/categories.repository';
import { ServicesController } from '../controllers/services.controller';
import { ServicesService } from '../services/services.service';
import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';
import { ServiceEntity } from '../utils/types/catalog-domain.types';

class MemoryServicesRepository extends ServicesRepository {
  readonly items = new Map<string, Record<string, any>>();
  readonly queries: QueryCommandInput[] = [];

  protected override async get<T>(
    _table: string,
    key: { PK: string; SK: string },
  ): Promise<T | null> {
    return (this.items.get(`${key.PK}|${key.SK}`) as T) ?? null;
  }

  protected override async query<T>(params: QueryCommandInput): Promise<T[]> {
    const page = await this.queryPage<T>(params);
    return page.items;
  }

  protected override async queryAll<T>(params: QueryCommandInput): Promise<T[]> {
    const items: T[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const page = await this.queryPage<T>({
        ...params,
        ExclusiveStartKey: lastEvaluatedKey as QueryCommandInput['ExclusiveStartKey'],
      });
      items.push(...page.items);
      lastEvaluatedKey = page.lastEvaluatedKey;
    } while (lastEvaluatedKey);
    return items;
  }

  protected override async queryPage<T>(
    params: QueryCommandInput,
  ): Promise<{ items: T[]; lastEvaluatedKey?: Record<string, unknown> }> {
    this.queries.push(params);
    const values = params.ExpressionAttributeValues ?? {};
    let matched = [...this.items.values()];

    if (values[':gpk'] !== undefined) {
      matched = matched.filter((item) => item.GSI2PK === values[':gpk']);
    }
    if (values[':gsi2pk'] !== undefined) {
      matched = matched.filter((item) => item.GSI2PK === values[':gsi2pk']);
    }
    if (values[':gsi1pk'] !== undefined) {
      matched = matched.filter(
        (item) => item.GSI1PK === values[':gsi1pk'] && item.GSI1SK === values[':gsi1sk'],
      );
    }
    if (values[':pk'] !== undefined && values[':gsi2pk'] === undefined && values[':gpk'] === undefined) {
      matched = matched.filter((item) => item.PK === values[':pk']);
    }
    const sortPrefix = values[':gsi2pk'] !== undefined
      ? values[':skPrefix']
      : values[':prefix'] ?? values[':skPrefix'];
    if (typeof sortPrefix === 'string') {
      const field = values[':gsi2pk'] !== undefined ? 'GSI2SK' : 'SK';
      matched = matched.filter((item) => String(item[field] ?? '').startsWith(sortPrefix));
    }
    if (values[':et'] !== undefined) {
      matched = matched.filter((item) => item.entityType === values[':et']);
    }
    if (params.FilterExpression?.includes('#active')) {
      matched = matched.filter((item) => item.active === values[':active']);
    }

    matched.sort((left, right) => String(left.SK).localeCompare(String(right.SK)));
    const start = typeof params.ExclusiveStartKey?.index === 'number'
      ? params.ExclusiveStartKey.index
      : 0;
    const limit = params.Limit ?? matched.length;
    const page = matched.slice(start, start + limit);
    const more = start + limit < matched.length;
    return {
      items: page as T[],
      lastEvaluatedKey: more ? { index: start + limit } : undefined,
    };
  }

  protected override async transactWrite(params: TransactWriteCommandInput): Promise<void> {
    const next = new Map(this.items);
    for (const entry of params.TransactItems ?? []) {
      if (entry.Put?.Item) {
        const item = entry.Put.Item as Record<string, any>;
        const existing = next.get(`${item.PK}|${item.SK}`);
        if (conditionFails(entry.Put.ConditionExpression, existing, entry.Put.ExpressionAttributeValues)) {
          throw new ConditionalWriteConflictError(new Error('conditional'));
        }
      }
      if (entry.Delete?.Key && entry.Delete.ConditionExpression?.includes('attribute_exists')) {
        const key = entry.Delete.Key as { PK: string; SK: string };
        if (!next.has(`${key.PK}|${key.SK}`)) {
          throw new ConditionalWriteConflictError(new Error('missing'));
        }
      }
    }

    for (const entry of params.TransactItems ?? []) {
      if (entry.Put?.Item) {
        const item = entry.Put.Item as Record<string, any>;
        next.set(`${item.PK}|${item.SK}`, item);
      }
      if (entry.Delete?.Key) {
        const key = entry.Delete.Key as { PK: string; SK: string };
        next.delete(`${key.PK}|${key.SK}`);
      }
    }
    this.items.clear();
    for (const [key, value] of next) {
      this.items.set(key, value);
    }
  }
}

function conditionFails(
  expression: string | undefined,
  existing: Record<string, any> | undefined,
  values: QueryCommandInput['ExpressionAttributeValues'],
): boolean {
  if (!expression) {
    return false;
  }
  if (expression.includes('attribute_not_exists(PK) AND attribute_not_exists(SK)')) {
    return Boolean(existing);
  }
  if (expression.includes('attribute_exists(PK) AND attribute_exists(SK)')) {
    return !existing;
  }
  if (expression.includes('reviewedAt <= :reviewedAt')) {
    return Boolean(existing) && String(existing?.reviewedAt ?? '') > String(values?.[':reviewedAt'] ?? '');
  }
  if (expression.includes('updatedAt <= :updatedAt') && !expression.includes('serviceUpdatedAt')) {
    return Boolean(existing) && String(existing?.updatedAt ?? '') > String(values?.[':updatedAt'] ?? '');
  }
  if (expression.includes('serviceUpdatedAt')) {
    if (!existing) {
      return false;
    }
    return discoveryWriteBlocked(existing as never, {
      serviceUpdatedAt: String(values?.[':serviceUpdatedAt'] ?? ''),
      vendorReviewedAt: String(values?.[':vendorReviewedAt'] ?? ''),
      branchUpdatedAt: String(values?.[':branchUpdatedAt'] ?? ''),
      priceUpdatedAt: String(values?.[':priceUpdatedAt'] ?? ''),
    });
  }
  return false;
}

function request(body?: unknown, params: Record<string, unknown> = {}): LambdaRequest {
  return { body, params, context: {} } as unknown as LambdaRequest;
}

function historicalService(input: {
  vendorId: string;
  serviceId: string;
  categoryId?: string;
  name: string;
  basePrice: number;
  active?: boolean;
  description?: string;
}): ServiceEntity {
  const categoryId = input.categoryId ?? 'cat-1';
  return {
    PK: CatalogKeyBuilder.categoryPk(categoryId),
    SK: CatalogKeyBuilder.serviceSk(input.serviceId),
    entityType: 'SERVICE',
    vendorId: input.vendorId,
    categoryId,
    serviceId: input.serviceId,
    name: input.name,
    description: input.description,
    durationMinutes: 40,
    vehicleTypes: ['SUV', 'SEDAN'],
    basePrice: input.basePrice,
    displayOrder: 0,
    active: input.active ?? true,
    version: 1,
    GSI1PK: input.name.toLowerCase(),
    GSI1SK: CatalogKeyBuilder.gsi1VendorCategorySk('SERVICE', input.vendorId, categoryId),
    GSI2PK: CatalogKeyBuilder.vendorPk(input.vendorId),
    GSI2SK: CatalogKeyBuilder.vendorServiceSk(categoryId, input.serviceId),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('discovery projection keys', () => {
  it('keeps vendor catalog and discovery partitions on different GSI2 values', () => {
    const service = historicalService({
      vendorId: 'vendor-1',
      serviceId: 'svc-1',
      name: 'Interior Detail',
      basePrice: 500,
    });
    const plan = buildDiscoveryWritePlan({
      service,
      vendor: null,
      branches: [],
      price: null,
      existingPointers: [],
    });

    expect(plan.items.map((item) => item.GSI2PK).sort()).toEqual([
      'DISCOVERY#ALL',
      'DISCOVERY#CATEGORY#cat-1',
    ]);
    expect(new Set(plan.items.map((item) => item.PK)).size).toBe(2);
    expect(plan.items.every((item) => item.GSI2PK !== CatalogKeyBuilder.vendorPk('vendor-1'))).toBe(true);
    expect(plan.items.every((item) => item.vendorApproved === false)).toBe(true);
    expect(plan.items.every((item) => item.branchOperational === false)).toBe(true);
  });
});

describe('marketplace discovery', () => {
  const repository = new MemoryServicesRepository();
  const categories = {
    findById: jest.fn(async (categoryId: string) => ({
      categoryId,
      active: true,
      entityType: 'CATEGORY',
    })),
  };
  const service = new ServicesService(
    repository,
    categories as unknown as CategoriesRepository,
  );
  const controller = new ServicesController(service);

  const branch = {
    branchId: 'branch-1',
    operational: true,
    latitude: 12.9716,
    longitude: 77.5946,
    serviceRadiusKm: 15,
    updatedAt: '2026-02-01T00:00:00.000Z',
  };

  async function approve(vendorId: string, reviewedAt = '2026-02-01T00:00:00.000Z') {
    await service.applyVendorLifecycle({
      vendorId,
      newStatus: 'ACTIVE',
      reviewedAt,
    });
  }

  async function cover(vendorId: string, coverage = branch) {
    await service.applyBranchCoverage({ vendorId, ...coverage });
  }

  async function create(input: {
    vendorId: string;
    categoryId?: string;
    name: string;
    description?: string;
    basePrice: number;
    vehicleTypes?: string[];
    active?: boolean;
  }) {
    return service.postservices(request({
      vendorId: input.vendorId,
      categoryId: input.categoryId ?? 'cat-1',
      name: input.name,
      description: input.description,
      durationMinutes: 45,
      vehicleTypes: input.vehicleTypes ?? ['SUV', 'SEDAN'],
      basePrice: input.basePrice,
      active: input.active ?? true,
    }));
  }

  beforeEach(() => {
    repository.items.clear();
    repository.queries.length = 0;
  });

  it('returns an eligible active service without search text or coordinates', async () => {
    await approve('vendor-1');
    await cover('vendor-1');
    await create({
      vendorId: 'vendor-1',
      name: 'Foam Wash',
      description: 'Deep interior shampoo',
      basePrice: 700,
    });

    const page = await controller.handleDiscoverServices({
      query: { limit: '20' },
    } as unknown as LambdaRequest);

    expect(page.items).toEqual([
      expect.objectContaining({
        vendorId: 'vendor-1',
        name: 'Foam Wash',
        displayPrice: 700,
        durationMinutes: 45,
        rating: undefined,
      }),
    ]);
    expect(page.hasMore).toBe(false);
    const discoveryQuery = repository.queries.find((query) => query.ExpressionAttributeValues?.[':gpk']);
    expect(discoveryQuery).toEqual(expect.objectContaining({
      IndexName: 'GSI2',
      ExpressionAttributeValues: expect.objectContaining({
        ':gpk': 'DISCOVERY#ALL',
      }),
    }));
  });

  it('keeps a new service out of discovery until the vendor and branch are eligible', async () => {
    await create({
      vendorId: 'vendor-1',
      name: 'Foam Wash',
      basePrice: 700,
    });
    expect((await service.discoverServices({ limit: 20 })).items).toEqual([]);

    await approve('vendor-1');
    expect((await service.discoverServices({ limit: 20 })).items).toEqual([]);

    await cover('vendor-1', { ...branch, operational: false });
    expect((await service.discoverServices({ limit: 20 })).items).toEqual([]);

    await cover('vendor-1');
    expect((await service.discoverServices({ limit: 20 })).items).toHaveLength(1);
  });

  it('matches interior search, category, and vehicle type', async () => {
    await approve('vendor-1');
    await cover('vendor-1');
    await create({
      vendorId: 'vendor-1',
      name: 'Foam Wash',
      description: 'Deep interior shampoo',
      basePrice: 700,
      vehicleTypes: ['SUV'],
    });
    await create({
      vendorId: 'vendor-1',
      categoryId: 'cat-2',
      name: 'Engine Bay',
      description: 'Degrease',
      basePrice: 900,
      vehicleTypes: ['SEDAN'],
    });

    const searched = await service.discoverServices({ search: 'interior', limit: '20' });
    expect(searched.items.map((item) => item.name)).toEqual(['Foam Wash']);

    const category = await service.discoverServices({ categoryId: 'cat-2', limit: 20 });
    expect(category.items.map((item) => item.name)).toEqual(['Engine Bay']);
    expect(repository.queries.at(-1)?.ExpressionAttributeValues?.[':gpk']).toBe(
      'DISCOVERY#CATEGORY#cat-2',
    );

    const vehicles = await service.discoverServices({ vehicleType: 'SUV', limit: 20 });
    expect(vehicles.items.map((item) => item.name)).toEqual(['Foam Wash']);
  });

  it('excludes inactive services and unapproved vendors', async () => {
    await approve('vendor-1');
    await cover('vendor-1');
    await cover('vendor-2');
    await create({ vendorId: 'vendor-1', name: 'Closed Bay', basePrice: 100, active: false });
    await create({ vendorId: 'vendor-2', name: 'Pending Wash', basePrice: 100 });

    const page = await service.discoverServices({ limit: 20 });
    expect(page.items).toEqual([]);
  });

  it('sorts price across vendors and pages without duplicates', async () => {
    await approve('vendor-1');
    await approve('vendor-2');
    await cover('vendor-1');
    await cover('vendor-2');
    await create({ vendorId: 'vendor-1', name: 'Mid Wash', basePrice: 500 });
    await create({ vendorId: 'vendor-2', name: 'Budget Wash', basePrice: 200 });
    await create({ vendorId: 'vendor-1', name: 'Premium Wash', basePrice: 800 });

    const sorted = await service.discoverServices({
      sortBy: 'PRICE_ASC',
      limit: 20,
    });
    expect(sorted.items.map((item) => item.displayPrice)).toEqual([200, 500, 800]);

    const first = await service.discoverServices({ sortBy: 'PRICE_ASC', limit: 1 });
    const second = await service.discoverServices({
      sortBy: 'PRICE_ASC',
      limit: 1,
      nextToken: first.nextToken,
    });
    const third = await service.discoverServices({
      sortBy: 'PRICE_ASC',
      limit: 1,
      nextToken: second.nextToken,
    });
    const ids = [first, second, third].map((page) => page.items[0]?.serviceId);
    expect(new Set(ids).size).toBe(3);
    expect(third.hasMore).toBe(false);
    expect(first.items[0]?.displayPrice).toBe(200);
  });

  it('filters distance when branch coverage is known', async () => {
    await approve('vendor-1');
    await cover('vendor-1', branch);
    await cover('vendor-1', {
      branchId: 'branch-far',
      operational: true,
      latitude: 28.6139,
      longitude: 77.209,
      serviceRadiusKm: 20,
      updatedAt: '2026-02-02T00:00:00.000Z',
    });
    await create({
      vendorId: 'vendor-1',
      name: 'Mobile Wash',
      basePrice: 650,
    });

    const nearby = await service.discoverServices({
      latitude: 12.9716,
      longitude: 77.5946,
      radiusKm: 10,
      sortBy: 'DISTANCE_ASC',
      limit: 20,
    });
    expect(nearby.items.map((item) => item.branchId)).toEqual(['branch-1']);
    expect(nearby.items[0]?.distanceKm).toBe(0);

    const unfiltered = await service.discoverServices({ limit: 20 });
    expect(unfiltered.items).toHaveLength(2);
  });

  it('refreshes discovery on update and removes it on delete', async () => {
    await approve('vendor-1');
    await cover('vendor-1');
    const created = await create({
      vendorId: 'vendor-1',
      name: 'Foam Wash',
      basePrice: 700,
    });

    const updated = await service.putserviceid(request(
      { name: 'Interior Reset', basePrice: 450 },
      { serviceId: created.id, vendorId: 'vendor-1', categoryId: 'cat-1' },
    ));
    expect(updated.name).toBe('Interior Reset');

    const found = await service.discoverServices({ search: 'interior', sortBy: 'PRICE_ASC', limit: 20 });
    expect(found.items).toEqual([
      expect.objectContaining({ name: 'Interior Reset', displayPrice: 450 }),
    ]);

    await service.applyServicePrice({
      vendorId: 'vendor-1',
      serviceId: created.id as string,
      enabled: true,
      priceOverride: 125,
      updatedAt: '2026-03-01T00:00:00.000Z',
    });
    const priced = await service.discoverServices({ limit: 20 });
    expect(priced.items[0]?.displayPrice).toBe(125);

    await service.applyServicePrice({
      vendorId: 'vendor-1',
      serviceId: created.id as string,
      enabled: false,
      updatedAt: '2026-03-02T00:00:00.000Z',
    });
    expect((await service.discoverServices({ limit: 20 })).items).toEqual([]);

    await service.applyServicePrice({
      vendorId: 'vendor-1',
      serviceId: created.id as string,
      enabled: true,
      priceOverride: 125,
      updatedAt: '2026-03-03T00:00:00.000Z',
    });
    await service.deleteserviceid(request(undefined, {
      serviceId: created.id,
      vendorId: 'vendor-1',
      categoryId: 'cat-1',
    }));
    expect((await service.discoverServices({ limit: 20 })).items).toEqual([]);
    const listed = await service.getservices(request(undefined, { vendorId: 'vendor-1' }));
    expect(listed.items).toEqual([]);
  });

  it('leaves vendor listing on the vendor partition', async () => {
    await approve('vendor-1');
    await cover('vendor-1');
    await create({ vendorId: 'vendor-1', name: 'Foam Wash', basePrice: 700 });

    const listed = await service.getservices(request(undefined, { vendorId: 'vendor-1' }));
    expect(listed.items).toHaveLength(1);
    const vendorQuery = repository.queries.find((query) => query.ExpressionAttributeValues?.[':gsi2pk']);
    expect(vendorQuery?.IndexName).toBe('GSI2');
    expect(vendorQuery?.ExpressionAttributeValues?.[':gsi2pk']).toBe('VENDOR#vendor-1');
    expect(vendorQuery?.ExpressionAttributeValues?.[':skPrefix']).toBe('SERVICE#');
  });

  it('ignores a stale vendor lifecycle event', async () => {
    await approve('vendor-1', '2026-04-01T00:00:00.000Z');
    await cover('vendor-1');
    await create({ vendorId: 'vendor-1', name: 'Foam Wash', basePrice: 700 });

    await service.applyVendorLifecycle({
      vendorId: 'vendor-1',
      newStatus: 'SUSPENDED',
      reviewedAt: '2026-03-01T00:00:00.000Z',
    });

    expect((await service.discoverServices({ limit: 20 })).items).toHaveLength(1);
  });

  it('backfills one vendor without rewriting canonical services or newer projections', async () => {
    const canonical = historicalService({
      vendorId: '8bde8566-1cbe-4547-9781-14daec646aaa',
      serviceId: 'svc-old',
      name: 'Interior Detail',
      description: 'Cabin interior wash',
      basePrice: 640,
    });
    const other = historicalService({
      vendorId: 'vendor-other',
      serviceId: 'svc-other',
      name: 'Other Wash',
      basePrice: 100,
    });
    await repository.createService(canonical);
    await repository.createService(other);
    await repository.saveVendorDiscoveryState({
      PK: CatalogKeyBuilder.discoveryVendorPk(canonical.vendorId),
      SK: CatalogKeyBuilder.discoveryVendorSk(),
      entityType: 'DISCOVERY_VENDOR_STATE',
      vendorId: canonical.vendorId,
      approved: true,
      reviewedAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    await repository.saveBranchDiscoveryState({
      PK: CatalogKeyBuilder.discoveryBranchPk(canonical.vendorId),
      SK: CatalogKeyBuilder.discoveryBranchSk('branch-1'),
      entityType: 'DISCOVERY_BRANCH_STATE',
      vendorId: canonical.vendorId,
      branchId: 'branch-1',
      operational: true,
      latitude: 12.97,
      longitude: 77.59,
      serviceRadiusKm: 12,
      updatedAt: '2026-02-01T00:00:00.000Z',
    });

    const dry = await backfillDiscoveryProjections(repository, {
      vendorId: canonical.vendorId,
      dryRun: true,
    });
    expect(dry.created).toBe(2);
    expect(dry.processed).toBe(2);
    expect(await repository.getDiscoveryItem('DISCOVERY#ALL', 'SERVICE#svc-old#BRANCH#branch-1')).toBeNull();

    const wrote = await backfillDiscoveryProjections(repository, {
      vendorId: canonical.vendorId,
      dryRun: false,
    });
    expect(wrote).toEqual(expect.objectContaining({
      created: 2,
      updated: 0,
      failed: 0,
    }));

    const discovered = await service.discoverServices({ search: 'interior', limit: 20 });
    expect(discovered.items.map((item) => item.serviceId)).toEqual(['svc-old']);
    expect(await repository.getDiscoveryItem(
      'DISCOVERY#ALL',
      'SERVICE#svc-other#BRANCH#UNASSIGNED',
    )).toBeNull();

    const again = await backfillDiscoveryProjections(repository, {
      vendorId: canonical.vendorId,
      dryRun: false,
    });
    expect(again.skipped).toBe(2);
    expect(again.created).toBe(0);

    const stored = await repository.getDiscoveryItem('DISCOVERY#ALL', 'SERVICE#svc-old#BRANCH#branch-1');
    repository.items.set('DISCOVERY#ALL|SERVICE#svc-old#BRANCH#branch-1', {
      ...stored,
      name: 'Newer projection',
      serviceUpdatedAt: '2099-01-01T00:00:00.000Z',
    });
    const stale = await backfillDiscoveryProjections(repository, {
      vendorId: canonical.vendorId,
      dryRun: false,
    });
    expect(stale.skipped).toBeGreaterThan(0);
    expect((await repository.getDiscoveryItem(
      'DISCOVERY#ALL',
      'SERVICE#svc-old#BRANCH#branch-1',
    ))?.name).toBe('Newer projection');

    const saved = await repository.findById(canonical.categoryId, canonical.serviceId);
    expect(saved?.name).toBe('Interior Detail');
    expect(saved?.updatedAt).toBe(canonical.updatedAt);
  });

  it('counts failed projection writes and still requires an explicit vendor', async () => {
    await expect(backfillHandler({})).rejects.toThrow('vendorId is required');
    await expect(backfillHandler({ vendorId: 'vendor-1' })).rejects.toThrow('dryRun boolean is required');

    class FailingRepository extends MemoryServicesRepository {
      override async saveDiscoveryIfCurrent(): Promise<'created' | 'updated' | 'skipped'> {
        throw new Error('throughput');
      }
    }
    const failing = new FailingRepository();
    await failing.createService(historicalService({
      vendorId: 'vendor-1',
      serviceId: 'svc-fail',
      name: 'Foam Wash',
      basePrice: 10,
    }));
    const report = await backfillDiscoveryProjections(failing, {
      vendorId: 'vendor-1',
      dryRun: false,
    });
    expect(report.failed).toBeGreaterThan(0);
    expect(report.created).toBe(0);
  });

  it('builds projections from vendor facts without a stored branch or price', async () => {
    let serviceId = '';
    const sourced = new ServicesService(
      repository,
      categories as unknown as CategoriesRepository,
      {
        load: async () => ({
          vendor: {
            PK: CatalogKeyBuilder.discoveryVendorPk('vendor-1'),
            SK: CatalogKeyBuilder.discoveryVendorSk(),
            entityType: 'DISCOVERY_VENDOR_STATE',
            vendorId: 'vendor-1',
            approved: true,
            reviewedAt: '2026-02-01T00:00:00.000Z',
            updatedAt: '2026-02-01T00:00:00.000Z',
          },
          branches: [{
            PK: CatalogKeyBuilder.discoveryBranchPk('vendor-1'),
            SK: CatalogKeyBuilder.discoveryBranchSk('branch-1'),
            entityType: 'DISCOVERY_BRANCH_STATE',
            vendorId: 'vendor-1',
            branchId: 'branch-1',
            operational: true,
            latitude: 12.9716,
            longitude: 77.5946,
            serviceRadiusKm: 15,
            updatedAt: '2026-02-02T00:00:00.000Z',
          }],
          prices: serviceId
            ? [{
                PK: CatalogKeyBuilder.discoveryPricePk('vendor-1'),
                SK: CatalogKeyBuilder.discoveryPriceSk(serviceId),
                entityType: 'DISCOVERY_PRICE_STATE' as const,
                vendorId: 'vendor-1',
                serviceId,
                enabled: true,
                priceOverride: 125,
                updatedAt: '2026-03-01T00:00:00.000Z',
              }]
            : [],
        }),
      },
    );

    const created = await sourced.postservices(request({
      vendorId: 'vendor-1',
      categoryId: 'cat-1',
      name: 'Facts Wash',
      durationMinutes: 30,
      vehicleTypes: ['SUV'],
      basePrice: 700,
    }));
    serviceId = created.id as string;
    await sourced.syncDiscoveryFromVendor('vendor-1');

    const page = await sourced.discoverServices({ vehicleType: 'SUV', limit: 20 });
    expect(page.items).toEqual([
      expect.objectContaining({
        serviceId,
        branchId: 'branch-1',
        displayPrice: 125,
      }),
    ]);
    const discoveryQuery = [...repository.queries].reverse().find(
      (query) => query.ExpressionAttributeValues?.[':gpk'],
    );
    expect(discoveryQuery?.IndexName).toBe('GSI2');
    expect(discoveryQuery?.KeyConditionExpression).toContain('#gpk');
  });
});
