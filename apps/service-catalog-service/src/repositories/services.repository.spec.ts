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
