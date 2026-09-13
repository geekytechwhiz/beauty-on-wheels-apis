import { LambdaRequest } from '@api-hub/utils';
import { NotFoundError, UnauthorizedError } from '@api-hub/utils';

import { CapabilitiesService } from './capabilities.service';
import { CapabilitiesRepository } from '../repositories/capabilities.repository';
import { VendorsRepository } from '../repositories/vendors.repository';
import {
  VendorCapabilitiesDdbItem,
  VendorDdbItem,
} from '../types/repository.types';

function authRequest(overrides: Record<string, unknown> = {}): LambdaRequest {
  return {
    pathParameters: { vendorId: 'vendor-1', ...(overrides.pathParameters as object) },
    params: { vendorId: 'vendor-1', ...(overrides.params as object) },
    body: overrides.body,
    context: {
      userContext: { userId: 'user-1' },
    },
    ...overrides,
  } as unknown as LambdaRequest;
}

function vendorItem(): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'PROFILE',
    vendorId: 'vendor-1',
    ownerUserId: 'user-1',
    vendorType: 'BUSINESS',
    businessName: 'Glow',
    contactName: 'Priya',
    phoneNumber: '+919876543210',
    onboardingStatus: 'IN_PROGRESS',
    currentSection: 'BRANCH',
    completedSections: ['BUSINESS_INFO', 'OWNER_DETAILS', 'ADDRESS'],
    addressCity: 'Bengaluru',
    addressPostalCode: '560001',
    status: 'ACTIVE',
    operationalStatus: 'ONLINE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    GSI1PK: 'VENDOR',
    GSI1SK: 'STATUS#ACTIVE#OPERATIONAL#ONLINE#2026-01-01T00:00:00.000Z#vendor-1',
    GSI2PK: 'CITY#BENGALURU',
    GSI2SK: 'POSTAL#560001#2026-01-01T00:00:00.000Z#vendor-1',
    entityType: 'Vendor',
  };
}

function capabilitiesItem(): VendorCapabilitiesDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'CAPABILITIES',
    vendorId: 'vendor-1',
    vehicleTypes: ['SEDAN'],
    serviceIds: ['svc-1'],
    packageIds: ['pkg-1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entityType: 'VendorCapabilities',
  };
}

describe('CapabilitiesService', () => {
  let repository: jest.Mocked<CapabilitiesRepository>;
  let vendorsRepository: jest.Mocked<VendorsRepository>;
  let service: CapabilitiesService;

  beforeEach(() => {
    repository = {
      getCapabilities: jest.fn(),
      putCapabilities: jest.fn(),
    } as unknown as jest.Mocked<CapabilitiesRepository>;

    vendorsRepository = {
      getVendorById: jest.fn().mockResolvedValue(vendorItem()),
    } as unknown as jest.Mocked<VendorsRepository>;

    service = new CapabilitiesService(repository, vendorsRepository);
  });

  describe('getvendorcapabilities', () => {
    it('returns stored catalog references for the vendor', async () => {
      repository.getCapabilities.mockResolvedValue(capabilitiesItem());

      const result = await service.getvendorcapabilities(authRequest());

      expect(result.vendorId).toBe('vendor-1');
      expect(result.serviceIds).toEqual(['svc-1']);
      expect(result.packageIds).toEqual(['pkg-1']);
      expect(result).not.toHaveProperty('name');
      expect(result).not.toHaveProperty('basePrice');
    });

    it('returns empty capability lists when none have been saved', async () => {
      repository.getCapabilities.mockResolvedValue(null);

      const result = await service.getvendorcapabilities(authRequest());

      expect(result).toEqual({
        vendorId: 'vendor-1',
        vehicleTypes: [],
        serviceIds: [],
        packageIds: [],
      });
    });

    it('lists capability master data without vendor assignment records', async () => {
      const result = await service.listavailablecapabilities(authRequest());

      expect(result.vehicleTypes.length).toBeGreaterThan(0);
      expect(result.catalogSources.services).toBe('service-catalog-service');
      expect(result.vehicleTypes[0]).toHaveProperty('capabilityId');
    });

    it('returns 404 when the vendor does not exist', async () => {
      vendorsRepository.getVendorById.mockResolvedValue(null);

      await expect(
        service.getvendorcapabilities(authRequest()),
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects capability reads when the caller is unauthenticated', async () => {
      await expect(
        service.getvendorcapabilities(
          authRequest({ context: { userContext: {} } }),
        ),
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updatevendorcapabilities', () => {
    it('replaces vendor capability references without catalog master data', async () => {
      repository.getCapabilities.mockResolvedValue(null);
      repository.putCapabilities.mockResolvedValue(undefined);

      const result = await service.updatevendorcapabilities(
        authRequest({
          body: {
            vehicleTypes: ['SUV', 'SUV'],
            serviceIds: ['svc-1', 'svc-2'],
            packageIds: ['pkg-1'],
          },
        }),
      );

      expect(result.vehicleTypes).toEqual(['SUV']);
      expect(result.serviceIds).toEqual(['svc-1', 'svc-2']);
      expect(repository.putCapabilities).toHaveBeenCalledTimes(1);
      const saved = repository.putCapabilities.mock.calls[0][0];
      expect(saved.PK).toBe('VENDOR#vendor-1');
      expect(saved.SK).toBe('CAPABILITIES');
      expect(saved).not.toHaveProperty('name');
      expect(saved).not.toHaveProperty('durationMinutes');
      expect(saved).not.toHaveProperty('basePrice');
    });

    it('returns 404 when replacing capabilities for a missing vendor', async () => {
      vendorsRepository.getVendorById.mockResolvedValue(null);

      await expect(
        service.updatevendorcapabilities(
          authRequest({
            body: {
              vehicleTypes: ['SEDAN'],
              serviceIds: [],
              packageIds: [],
            },
          }),
        ),
      ).rejects.toThrow(NotFoundError);
      expect(repository.putCapabilities).not.toHaveBeenCalled();
    });
  });
});
