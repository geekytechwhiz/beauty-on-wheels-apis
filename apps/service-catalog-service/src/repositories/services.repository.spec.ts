jest.mock('../configs/env.config', () => ({
  env: {
    DYNAMODB_TABLE_NAME: 'catalog-test',
    SERVICE_NAME: 'service-catalog-service',
    LOG_LEVEL: 'info',
    EVENT_BUS_NAME: '',
    VENDOR_SERVICE_URL: '',
  },
}));

import { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

import { ServicesRepository } from './services.repository';
import { ServiceEntity } from '../utils/types/catalog-domain.types';

class ProbeServicesRepository extends ServicesRepository {
  written?: TransactWriteCommandInput;
  queried: unknown[] = [];

  protected override async transactWrite(
    params: TransactWriteCommandInput,
  ): Promise<void> {
    this.written = params;
  }

  protected override async queryAll<T>(params: unknown): Promise<T[]> {
    this.queried.push(params);
    return [
      { serviceId: 'svc-1', vehicleType: 'SUV' },
      { serviceId: 'svc-1', vehicleType: 'MUV' },
    ] as T[];
  }

  protected override async get<T>(): Promise<T | null> {
    return {
      entityType: 'SERVICE',
      serviceId: 'svc-1',
      vehicleTypes: ['HATCHBACK', 'SUV', 'MUV'],
    } as T;
  }
}

function service(): ServiceEntity {
  return {
    PK: 'CAT#cat-1',
    SK: 'SERVICE#svc-1',
    entityType: 'SERVICE',
    vendorId: 'vendor-1',
    categoryId: 'cat-1',
    serviceId: 'svc-1',
    name: 'Premium Wash',
    durationMinutes: 45,
    vehicleTypes: ['HATCHBACK', 'SUV', 'MUV'],
    basePrice: 750,
    displayOrder: 0,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('ServicesRepository vehicle applicability', () => {
  it('writes one applicability row per vehicle type and a service lookup', async () => {
    const repository = new ProbeServicesRepository();
    await repository.createService(service());

    const items = (repository.written?.TransactItems ?? []).map(
      (entry) => entry.Put?.Item as { PK: string; SK: string; entityType: string; LSI4SK?: string },
    );
    const serviceItem = items.find((item) => item.entityType === 'SERVICE');
    expect(serviceItem?.LSI4SK).toBeUndefined();
    expect(items.map((item) => item.SK).sort()).toEqual([
      'META',
      'SERVICE#svc-1',
      'VEHICLE#HATCHBACK#SERVICE#svc-1',
      'VEHICLE#MUV#SERVICE#svc-1',
      'VEHICLE#SUV#SERVICE#svc-1',
    ]);
  });

  it('queries every applicability prefix instead of LSI4', async () => {
    const repository = new ProbeServicesRepository();
    const found = await repository.listByVehicleType('cat-1', 'MUV');

    expect(repository.queried[0]).toEqual(
      expect.objectContaining({
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeValues: expect.objectContaining({
          ':prefix': 'VEHICLE#MUV#SERVICE#',
        }),
      }),
    );
    expect((repository.queried[0] as { IndexName?: string }).IndexName).toBeUndefined();
    expect(found).toHaveLength(2);
  });
});

describe('ServicesRepository vehicle pricing pages', () => {
  function row(serviceId: string, vehicleTypes: string[]): ServiceEntity {
    return {
      PK: 'CAT#cat-1',
      SK: `SERVICE#${serviceId}`,
      entityType: 'SERVICE',
      vendorId: 'vendor-1',
      categoryId: 'cat-1',
      serviceId,
      name: serviceId,
      durationMinutes: 45,
      vehicleTypes,
      vehiclePricing: vehicleTypes.map((vehicleType) => ({
        vehicleType,
        price: vehicleType === 'SUV' ? 699 : 399,
        durationMinutes: vehicleType === 'SUV' ? 60 : 30,
      })),
      basePrice: 399,
      displayOrder: 0,
      active: true,
      GSI2PK: 'VENDOR#vendor-1',
      GSI2SK: `SERVICE#cat-1#${serviceId}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  class PagingRepository extends ServicesRepository {
    readonly items: ServiceEntity[];

    constructor(items: ServiceEntity[]) {
      super();
      this.items = items;
    }

    protected override async queryPage<T>(params: {
      ExclusiveStartKey?: { SK?: string };
      Limit?: number;
    }): Promise<{ items: T[]; lastEvaluatedKey?: Record<string, unknown> }> {
      const start = params.ExclusiveStartKey?.SK;
      const startIndex = start
        ? this.items.findIndex((item) => item.SK === start) + 1
        : 0;
      const limit = params.Limit ?? this.items.length;
      const slice = this.items.slice(startIndex, startIndex + limit);
      const last = slice[slice.length - 1];
      const more = startIndex + slice.length < this.items.length;
      return {
        items: slice as T[],
        lastEvaluatedKey: more && last
          ? { PK: last.PK, SK: last.SK, GSI2PK: last.GSI2PK, GSI2SK: last.GSI2SK }
          : undefined,
      };
    }
  }

  it('fills a vehicle-type page without skipping later matches', async () => {
    const repository = new PagingRepository([
      row('hatch', ['HATCHBACK']),
      row('suv-a', ['SUV']),
      row('sedan', ['SEDAN']),
      row('suv-b', ['HATCHBACK', 'SUV']),
      row('suv-c', ['SUV']),
    ]);

    const first = await repository.listByVendor('vendor-1', { vehicleType: 'SUV', limit: 2 });
    expect(first.items.map((item) => item.serviceId)).toEqual(['suv-a', 'suv-b']);
    expect(first.lastEvaluatedKey?.SK).toBe('SERVICE#suv-b');

    const second = await repository.listByVendor('vendor-1', {
      vehicleType: 'SUV',
      limit: 2,
      lastEvaluatedKey: first.lastEvaluatedKey,
    });
    expect(second.items.map((item) => item.serviceId)).toEqual(['suv-c']);
    expect(second.lastEvaluatedKey).toBeUndefined();
  });

  it('returns no rows when the vendor has no price for that vehicle type', async () => {
    const repository = new PagingRepository([
      row('hatch', ['HATCHBACK']),
      row('sedan', ['SEDAN']),
    ]);
    const page = await repository.listByVendor('vendor-1', { vehicleType: 'SUV', limit: 20 });
    expect(page.items).toEqual([]);
    expect(page.lastEvaluatedKey).toBeUndefined();
  });
});
