import { BaseError, LambdaRequest } from '@api-hub/utils';

import { PackagesService } from './packages.service';
import { PackagesRepository } from '../repositories/packages.repository';
import { ServicesRepository } from '../repositories/services.repository';
import { AddOnsRepository } from '../repositories/add-ons.repository';
import { ServiceEntity } from '../utils/types/catalog-domain.types';

function request(body: unknown): LambdaRequest {
  return { body, params: {}, context: {} } as unknown as LambdaRequest;
}

function catalogService(id: string, active = true): ServiceEntity {
  return {
    PK: 'CAT#cat-1',
    SK: `SERVICE#${id}`,
    entityType: 'SERVICE',
    categoryId: 'cat-1',
    serviceId: id,
    name: id,
    durationMinutes: 30,
    vehicleTypes: ['SUV'],
    basePrice: 100,
    displayOrder: 0,
    active,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('PackagesService validation', () => {
  const packages = {
    findByName: jest.fn().mockResolvedValue(null),
    createPackage: jest.fn(),
  };
  const services = { findByServiceId: jest.fn() };
  const addOns = { findByAddonId: jest.fn() };
  const service = new PackagesService(
    packages as unknown as PackagesRepository,
    services as unknown as ServicesRepository,
    addOns as unknown as AddOnsRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    packages.findByName.mockResolvedValue(null);
  });

  it('rejects a package that references a missing service', async () => {
    services.findByServiceId.mockResolvedValue(null);

    await expect(
      service.postpackages(
        request({
          name: 'Premium Complete',
          discountedPrice: 500,
          items: [{ serviceId: 'missing' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_FOUND', statusCode: 404 });
    expect(packages.createPackage).not.toHaveBeenCalled();
  });

  it('rejects an inactive service and duplicate service ids', async () => {
    services.findByServiceId.mockResolvedValue(catalogService('svc-1', false));

    await expect(
      service.postpackages(
        request({
          name: 'Premium Complete',
          discountedPrice: 500,
          items: [{ serviceId: 'svc-1' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });

    await expect(
      service.postpackages(
        request({
          name: 'Premium Complete',
          discountedPrice: 500,
          items: [{ serviceId: 'svc-1' }, { serviceId: 'svc-1' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
  });

  it('stores service references without copying service documents', async () => {
    services.findByServiceId.mockImplementation(async (id: string) => catalogService(id));
    packages.createPackage.mockResolvedValue(undefined);

    await service.postpackages(
      request({
        name: 'Premium Complete',
        discountedPrice: 800,
        items: [{ serviceId: 'wash' }, { serviceId: 'wax' }],
      }),
    );

    const items = packages.createPackage.mock.calls[0][1];
    expect(items.map((item: { refId: string }) => item.refId)).toEqual(['wash', 'wax']);
    expect(items[0]).not.toHaveProperty('basePrice');
  });
});

describe('package error type', () => {
  it('uses BaseError for invalid packages', () => {
    expect(new BaseError('bad', 400, 'INVALID_PACKAGE').statusCode).toBe(400);
  });
});
