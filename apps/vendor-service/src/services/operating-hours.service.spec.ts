import { LambdaRequest } from '@api-hub/utils';
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@api-hub/utils';

import { OperatingHoursService } from './operating-hours.service';
import { OperatingHoursRepository } from '../repositories/operating-hours.repository';
import { VendorsRepository } from '../repositories/vendors.repository';
import {
  VendorDdbItem,
  VendorOperatingHoursDdbItem,
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

function hoursItem(): VendorOperatingHoursDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'HOURS',
    vendorId: 'vendor-1',
    operatingHours: [
      {
        dayOfWeek: 'MONDAY',
        closed: false,
        openTime: '09:00',
        closeTime: '18:00',
      },
      { dayOfWeek: 'SUNDAY', closed: true },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entityType: 'VendorOperatingHours',
  };
}

describe('OperatingHoursService', () => {
  let repository: jest.Mocked<OperatingHoursRepository>;
  let vendorsRepository: jest.Mocked<VendorsRepository>;
  let service: OperatingHoursService;

  beforeEach(() => {
    repository = {
      getOperatingHours: jest.fn(),
      putOperatingHours: jest.fn(),
    } as unknown as jest.Mocked<OperatingHoursRepository>;

    vendorsRepository = {
      getVendorById: jest.fn().mockResolvedValue(vendorItem()),
    } as unknown as jest.Mocked<VendorsRepository>;

    service = new OperatingHoursService(repository, vendorsRepository);
  });

  describe('getvendoroperatinghours', () => {
    it('returns stored weekly hours for the vendor', async () => {
      repository.getOperatingHours.mockResolvedValue(hoursItem());

      const result = await service.getvendoroperatinghours(authRequest());

      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        vendorId: 'vendor-1',
        dayOfWeek: 'MONDAY',
        closed: false,
        openTime: '09:00',
        closeTime: '18:00',
      });
      expect(result.data[1]).toEqual({
        vendorId: 'vendor-1',
        dayOfWeek: 'SUNDAY',
        closed: true,
      });
    });

    it('returns an empty schedule when none has been saved', async () => {
      repository.getOperatingHours.mockResolvedValue(null);

      const result = await service.getvendoroperatinghours(authRequest());

      expect(result).toEqual({ data: [] });
    });

    it('returns 404 when the vendor does not exist', async () => {
      vendorsRepository.getVendorById.mockResolvedValue(null);

      await expect(
        service.getvendoroperatinghours(authRequest()),
      ).rejects.toThrow(NotFoundError);
      expect(repository.getOperatingHours).not.toHaveBeenCalled();
    });

    it('rejects operating-hours reads when the caller is unauthenticated', async () => {
      await expect(
        service.getvendoroperatinghours(
          authRequest({ context: { userContext: {} } }),
        ),
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updatevendoroperatinghours', () => {
    it('replaces the vendor weekly schedule', async () => {
      repository.getOperatingHours.mockResolvedValue(null);
      repository.putOperatingHours.mockResolvedValue(undefined);

      const result = await service.updatevendoroperatinghours(
        authRequest({
          body: {
            operatingHours: [
              { dayOfWeek: 'SUNDAY', closed: true },
              {
                dayOfWeek: 'MONDAY',
                closed: false,
                openTime: '09:00',
                closeTime: '18:00',
              },
            ],
          },
        }),
      );

      expect(result.data.map((entry) => entry.dayOfWeek)).toEqual([
        'MONDAY',
        'SUNDAY',
      ]);
      expect(repository.putOperatingHours).toHaveBeenCalledTimes(1);
      const saved = repository.putOperatingHours.mock.calls[0][0];
      expect(saved.PK).toBe('VENDOR#vendor-1');
      expect(saved.SK).toBe('HOURS');
      expect(saved.entityType).toBe('VendorOperatingHours');
      expect(saved.operatingHours[0]).toEqual({
        dayOfWeek: 'MONDAY',
        closed: false,
        openTime: '09:00',
        closeTime: '18:00',
      });
      expect(saved.operatingHours[1]).toEqual({
        dayOfWeek: 'SUNDAY',
        closed: true,
      });
    });

    it('rejects duplicate days', async () => {
      await expect(
        service.updatevendoroperatinghours(
          authRequest({
            body: {
              operatingHours: [
                {
                  dayOfWeek: 'MONDAY',
                  closed: false,
                  openTime: '09:00',
                  closeTime: '18:00',
                },
                { dayOfWeek: 'MONDAY', closed: true },
              ],
            },
          }),
        ),
      ).rejects.toThrow(ValidationError);
      expect(repository.putOperatingHours).not.toHaveBeenCalled();
    });

    it('requires open and close times when a day is not closed', async () => {
      await expect(
        service.updatevendoroperatinghours(
          authRequest({
            body: {
              operatingHours: [{ dayOfWeek: 'MONDAY', closed: false }],
            },
          }),
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects a close time that is not after open time', async () => {
      await expect(
        service.updatevendoroperatinghours(
          authRequest({
            body: {
              operatingHours: [
                {
                  dayOfWeek: 'MONDAY',
                  closed: false,
                  openTime: '18:00',
                  closeTime: '09:00',
                },
              ],
            },
          }),
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('returns 404 when replacing hours for a missing vendor', async () => {
      vendorsRepository.getVendorById.mockResolvedValue(null);

      await expect(
        service.updatevendoroperatinghours(
          authRequest({
            body: {
              operatingHours: [{ dayOfWeek: 'SUNDAY', closed: true }],
            },
          }),
        ),
      ).rejects.toThrow(NotFoundError);
      expect(repository.putOperatingHours).not.toHaveBeenCalled();
    });
  });
});
