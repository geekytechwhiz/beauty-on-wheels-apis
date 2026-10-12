import { ConditionalWriteConflictError } from '@api-hub/utils';

import { CapabilitiesRepository } from '../repositories/capabilities.repository';
import { VendorsRepository } from '../repositories/vendors.repository';
import { VendorCapabilitiesDdbItem, VendorDdbItem } from '../types/repository.types';
import { PricingConfigurationService } from './pricing-configuration.service';

function vendor(): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'PROFILE',
    vendorId: 'vendor-1',
    ownerUserId: 'owner-1',
    status: 'ACTIVE',
    operationalStatus: 'ONLINE',
    onboardingStatus: 'COMPLETED',
    currentSection: 'BRANCH',
    completedSections: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    GSI1PK: 'VENDOR',
    GSI1SK: 'STATUS#ACTIVE',
    entityType: 'Vendor',
  };
}

function capabilities(overrides: Partial<VendorCapabilitiesDdbItem> = {}): VendorCapabilitiesDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'CAPABILITIES',
    vendorId: 'vendor-1',
    vehicleTypes: ['SEDAN'],
    serviceIds: ['svc-1'],
    packageIds: [],
    services: [{ serviceId: 'svc-1', categoryId: 'cat-1', enabled: true, priceOverride: 550 }],
    packages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entityType: 'VendorCapabilities',
    ...overrides,
  };
}

describe('PricingConfigurationService', () => {
  const vendors = { getVendorById: jest.fn() };
  const capabilitiesRepo = { getCapabilities: jest.fn(), putCapabilities: jest.fn() };
  const service = new PricingConfigurationService(
    vendors as unknown as VendorsRepository,
    capabilitiesRepo as unknown as CapabilitiesRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    vendors.getVendorById.mockResolvedValue(vendor());
  });

  it('returns enabled offerings, overrides, and versions without owner fields', async () => {
    capabilitiesRepo.getCapabilities.mockResolvedValue(capabilities({
      configurationVersion: 4,
      services: [{ serviceId: 'svc-1', categoryId: 'cat-1', enabled: true, priceOverride: 550, version: 2 }],
    }));

    const result = await service.get('vendor-1');

    expect(result).toEqual({
      vendorId: 'vendor-1',
      configurationVersion: 4,
      services: [{ serviceId: 'svc-1', enabled: true, priceOverride: 550, version: 2 }],
      packages: [],
    });
    expect(capabilitiesRepo.putCapabilities).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('vehicleTypes');
  });

  it('backfills version 1 onto an existing record and does not invent a higher version', async () => {
    capabilitiesRepo.getCapabilities.mockResolvedValue(capabilities());
    capabilitiesRepo.putCapabilities.mockResolvedValue(undefined);

    const result = await service.get('vendor-1');

    expect(result.configurationVersion).toBe(1);
    expect(result.services[0].version).toBe(1);
    expect(capabilitiesRepo.putCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({
        configurationVersion: 1,
        services: [expect.objectContaining({ serviceId: 'svc-1', version: 1, priceOverride: 550 })],
      }),
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('returns an empty baseline when the vendor has no capabilities record', async () => {
    capabilitiesRepo.getCapabilities.mockResolvedValue(null);

    await expect(service.get('vendor-1')).resolves.toEqual({
      vendorId: 'vendor-1',
      configurationVersion: 1,
      services: [],
      packages: [],
    });
    expect(capabilitiesRepo.putCapabilities).not.toHaveBeenCalled();
  });

  it('retries a concurrent backfill and then returns the committed versions', async () => {
    capabilitiesRepo.getCapabilities
      .mockResolvedValueOnce(capabilities())
      .mockResolvedValueOnce(capabilities({
        configurationVersion: 2,
        services: [{ serviceId: 'svc-1', enabled: true, priceOverride: 700, version: 2 }],
        updatedAt: '2026-02-01T00:00:00.000Z',
      }));
    capabilitiesRepo.putCapabilities.mockRejectedValueOnce(new ConditionalWriteConflictError('conflict'));

    const result = await service.get('vendor-1');

    expect(result.services[0]).toMatchObject({ priceOverride: 700, version: 2 });
    expect(result.configurationVersion).toBe(2);
  });

  it('rejects an unknown vendor', async () => {
    vendors.getVendorById.mockResolvedValue(null);
    await expect(service.get('missing')).rejects.toMatchObject({ code: 'VENDOR_NOT_FOUND', statusCode: 404 });
  });
});
