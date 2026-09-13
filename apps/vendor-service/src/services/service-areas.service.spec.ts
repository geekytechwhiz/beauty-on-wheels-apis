import { LambdaRequest } from '@api-hub/utils';
import {
  ConflictError,
  ConditionalWriteConflictError,
  NotFoundError,
  UnauthorizedError,
} from '@api-hub/utils';

import { ServiceAreasService } from './service-areas.service';
import { ServiceAreasRepository } from '../repositories/service-areas.repository';
import { VendorsRepository } from '../repositories/vendors.repository';
import { ServiceAreaDdbItem } from '../types/repository.types';
import { VendorDdbItem } from '../types/repository.types';

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

function serviceAreaItem(
  overrides: Partial<ServiceAreaDdbItem> = {},
): ServiceAreaDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'SERVICE_AREA#area-1',
    serviceAreaId: 'area-1',
    vendorId: 'vendor-1',
    name: 'Indiranagar',
    city: 'Bengaluru',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entityType: 'ServiceArea',
    ...overrides,
  };
}

describe('ServiceAreasService', () => {
  let repository: jest.Mocked<ServiceAreasRepository>;
  let vendorsRepository: jest.Mocked<VendorsRepository>;
  let service: ServiceAreasService;

  beforeEach(() => {
    repository = {
      createServiceArea: jest.fn(),
      getServiceArea: jest.fn(),
      listServiceAreas: jest.fn(),
      updateServiceArea: jest.fn(),
      deleteServiceArea: jest.fn(),
    } as unknown as jest.Mocked<ServiceAreasRepository>;

    vendorsRepository = {
      getVendorById: jest.fn().mockResolvedValue(vendorItem()),
    } as unknown as jest.Mocked<VendorsRepository>;

    service = new ServiceAreasService(repository, vendorsRepository);
  });

  describe('listvendorserviceareas', () => {
    it('lists service areas for an existing vendor', async () => {
      repository.listServiceAreas.mockResolvedValue([serviceAreaItem()]);

      const result = await service.listvendorserviceareas(authRequest());

      expect(vendorsRepository.getVendorById).toHaveBeenCalledWith('vendor-1');
      expect(repository.listServiceAreas).toHaveBeenCalledWith('vendor-1');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].serviceAreaId).toBe('area-1');
      expect(result.data[0].vendorId).toBe('vendor-1');
    });

    it('returns 404 when the vendor does not exist', async () => {
      vendorsRepository.getVendorById.mockResolvedValue(null);

      await expect(
        service.listvendorserviceareas(authRequest()),
      ).rejects.toThrow(NotFoundError);
      expect(repository.listServiceAreas).not.toHaveBeenCalled();
    });

    it('rejects service-area listing when the caller is unauthenticated', async () => {
      await expect(
        service.listvendorserviceareas(
          authRequest({ context: { userContext: {} } }),
        ),
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('addvendorservicearea', () => {
    it('creates a vendor-owned service area', async () => {
      repository.createServiceArea.mockResolvedValue(undefined);

      const result = await service.addvendorservicearea(
        authRequest({
          body: { name: 'Koramangala', city: 'Bengaluru' },
        }),
      );

      expect(result.name).toBe('Koramangala');
      expect(result.vendorId).toBe('vendor-1');
      expect(result.active).toBe(true);
      expect(repository.createServiceArea).toHaveBeenCalledTimes(1);
      const saved = repository.createServiceArea.mock.calls[0][0] as ServiceAreaDdbItem & {
        GSI1PK?: string;
        GSI2PK?: string;
      };
      expect(saved.PK).toBe('VENDOR#vendor-1');
      expect(saved.SK).toMatch(/^SERVICE_AREA#/);
      expect(saved.GSI1PK).toBeUndefined();
      expect(saved.GSI2PK).toBeUndefined();
    });

    it('maps duplicate writes to ConflictError', async () => {
      repository.createServiceArea.mockRejectedValue(
        new ConditionalWriteConflictError('duplicate'),
      );

      await expect(
        service.addvendorservicearea(
          authRequest({
            body: { name: 'Koramangala', city: 'Bengaluru' },
          }),
        ),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('getvendorservicearea', () => {
    it('returns a service area owned by the vendor', async () => {
      repository.getServiceArea.mockResolvedValue(serviceAreaItem());

      const result = await service.getvendorservicearea(
        authRequest({
          pathParameters: { vendorId: 'vendor-1', serviceAreaId: 'area-1' },
          params: { vendorId: 'vendor-1', serviceAreaId: 'area-1' },
        }),
      );

      expect(result.serviceAreaId).toBe('area-1');
      expect(repository.getServiceArea).toHaveBeenCalledWith(
        'vendor-1',
        'area-1',
      );
    });

    it('returns 404 when the service area is missing', async () => {
      repository.getServiceArea.mockResolvedValue(null);

      await expect(
        service.getvendorservicearea(
          authRequest({
            pathParameters: { vendorId: 'vendor-1', serviceAreaId: 'missing' },
            params: { vendorId: 'vendor-1', serviceAreaId: 'missing' },
          }),
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('updatevendorservicearea', () => {
    it('updates an existing service area', async () => {
      repository.getServiceArea.mockResolvedValue(serviceAreaItem());
      repository.updateServiceArea.mockResolvedValue(undefined);

      const result = await service.updatevendorservicearea(
        authRequest({
          pathParameters: { vendorId: 'vendor-1', serviceAreaId: 'area-1' },
          params: { vendorId: 'vendor-1', serviceAreaId: 'area-1' },
          body: { name: 'Whitefield', active: false },
        }),
      );

      expect(result.name).toBe('Whitefield');
      expect(result.active).toBe(false);
      expect(repository.updateServiceArea).toHaveBeenCalled();
    });
  });

  describe('deletevendorservicearea', () => {
    it('hard-deletes a service area owned by the vendor', async () => {
      repository.getServiceArea.mockResolvedValue(serviceAreaItem());
      repository.deleteServiceArea.mockResolvedValue(undefined);

      await service.deletevendorservicearea(
        authRequest({
          pathParameters: { vendorId: 'vendor-1', serviceAreaId: 'area-1' },
          params: { vendorId: 'vendor-1', serviceAreaId: 'area-1' },
        }),
      );

      expect(repository.deleteServiceArea).toHaveBeenCalledWith(
        'vendor-1',
        'area-1',
      );
    });
  });
});
