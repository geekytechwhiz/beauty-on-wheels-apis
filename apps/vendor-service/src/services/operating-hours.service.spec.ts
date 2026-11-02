import { LambdaRequest } from '@api-hub/utils';
import { NotFoundError, UnauthorizedError, ValidationError } from '@api-hub/utils';

import { OperatingHoursService } from './operating-hours.service';
import { VendorsRepository } from '../repositories/vendors.repository';
import {
  VendorDdbItem,
  VendorOperatingPreferencesDdbItem,
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
    businessType: 'BUSINESS',
    businessName: 'Glow',
    contactName: 'Priya',
    phoneNumber: '+919876543210',
    onboardingStatus: 'IN_PROGRESS',
    currentSection: 'BUSINESS_INFO',
    completedSections: ['BUSINESS_INFO'],
    status: 'PENDING_VERIFICATION',
    operationalStatus: 'OFFLINE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    GSI1PK: 'VENDOR',
    GSI1SK: 'STATUS#PENDING_VERIFICATION#OPERATIONAL#OFFLINE#2026-01-01T00:00:00.000Z#vendor-1',
    entityType: 'Vendor',
  };
}

function preferencesItem(): VendorOperatingPreferencesDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'OPERATING_PREFERENCES',
    vendorId: 'vendor-1',
    serviceWindowIds: ['morning'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    entityType: 'VendorOperatingPreferences',
  };
}

describe('OperatingHoursService', () => {
  let vendorsRepository: jest.Mocked<VendorsRepository>;
  let service: OperatingHoursService;

  beforeEach(() => {
    vendorsRepository = {
      getVendorById: jest.fn().mockResolvedValue(vendorItem()),
      getOperatingPreferences: jest.fn().mockResolvedValue(preferencesItem()),
      putOperatingPreferences: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VendorsRepository>;
    service = new OperatingHoursService(vendorsRepository);
  });

  it('returns the service windows vendor detail and onboarding read', async () => {
    const result = await service.getvendoroperatinghours(authRequest());
    expect(result).toEqual({
      vendorId: 'vendor-1',
      serviceWindowIds: ['morning'],
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('replaces service windows on the preferences item', async () => {
    const result = await service.updatevendoroperatinghours(
      authRequest({
        body: { serviceWindowIds: ['weekday_morning', 'weekend_day'] },
      }),
    );

    expect(result.serviceWindowIds).toEqual(['weekday_morning', 'weekend_day']);
    const saved = vendorsRepository.putOperatingPreferences.mock.calls[0][0];
    expect(saved.entityType).toBe('VendorOperatingPreferences');
    expect(saved.SK).toBe('OPERATING_PREFERENCES');
    expect(saved.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(saved.serviceWindowIds).toEqual(['weekday_morning', 'weekend_day']);
  });

  it('does not write when the same windows are sent again', async () => {
    const result = await service.updatevendoroperatinghours(
      authRequest({ body: { serviceWindowIds: ['morning'] } }),
    );
    expect(result.updatedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(vendorsRepository.putOperatingPreferences).not.toHaveBeenCalled();
  });

  it('rejects an unknown or duplicate service window', async () => {
    await expect(
      service.updatevendoroperatinghours(
        authRequest({ body: { serviceWindowIds: ['evening'] } }),
      ),
    ).rejects.toThrow(ValidationError);
    await expect(
      service.updatevendoroperatinghours(
        authRequest({ body: { serviceWindowIds: ['morning', 'morning'] } }),
      ),
    ).rejects.toThrow(ValidationError);
    expect(vendorsRepository.putOperatingPreferences).not.toHaveBeenCalled();
  });

  it('returns 404 when the vendor does not exist', async () => {
    vendorsRepository.getVendorById.mockResolvedValue(null);
    await expect(
      service.updatevendoroperatinghours(
        authRequest({ body: { serviceWindowIds: ['morning'] } }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(
      service.getvendoroperatinghours({
        pathParameters: { vendorId: 'vendor-1' },
        context: {},
      } as LambdaRequest),
    ).rejects.toThrow(UnauthorizedError);
  });
});
