import { LambdaRequest } from '@api-hub/utils';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '@api-hub/utils';

import { StaffService } from './staff.service';
import { StaffRepository } from '../repositories/staff.repository';
import { VendorsRepository } from '../repositories/vendors.repository';
import { StaffDdbItem, VendorDdbItem } from '../types/repository.types';

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

function staffItem(overrides: Partial<StaffDdbItem> = {}): StaffDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'STAFF#staff-1',
    staffId: 'staff-1',
    vendorId: 'vendor-1',
    name: 'Ananya Reddy',
    phoneNumber: '+919900112233',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entityType: 'Staff',
    ...overrides,
  };
}

describe('StaffService', () => {
  let repository: jest.Mocked<StaffRepository>;
  let vendorsRepository: jest.Mocked<VendorsRepository>;
  let service: StaffService;

  beforeEach(() => {
    repository = {
      createStaff: jest.fn(),
      getStaff: jest.fn(),
      listStaff: jest.fn(),
      findStaffByUserId: jest.fn(),
      updateStaff: jest.fn(),
    } as unknown as jest.Mocked<StaffRepository>;

    vendorsRepository = {
      getVendorById: jest.fn().mockResolvedValue(vendorItem()),
    } as unknown as jest.Mocked<VendorsRepository>;

    service = new StaffService(repository, vendorsRepository);
  });

  describe('listvendorstaff', () => {
    it('lists vendor-owned staff with pagination', async () => {
      repository.listStaff.mockResolvedValue({
        items: [staffItem()],
      });

      const result = await service.listvendorstaff(authRequest());

      expect(repository.listStaff).toHaveBeenCalledWith(
        expect.objectContaining({ vendorId: 'vendor-1' }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].staffId).toBe('staff-1');
      expect(result.pagination?.hasMore).toBe(false);
    });

    it('returns 404 when the vendor does not exist', async () => {
      vendorsRepository.getVendorById.mockResolvedValue(null);

      await expect(service.listvendorstaff(authRequest())).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('createvendorstaff', () => {
    it('creates staff without a portal identity when userId is omitted', async () => {
      repository.createStaff.mockResolvedValue(undefined);

      const result = await service.createvendorstaff(
        authRequest({
          body: {
            name: 'Ananya Reddy',
            phoneNumber: '+919900112233',
            role: 'STYLIST',
          },
        }),
      );

      expect(result.userId).toBeUndefined();
      expect(result.vendorId).toBe('vendor-1');
      expect(result.status).toBe('ACTIVE');
      expect(repository.findStaffByUserId).not.toHaveBeenCalled();
      const saved = repository.createStaff.mock.calls[0][0];
      expect(saved.userId).toBeUndefined();
      expect(saved.PK).toBe('VENDOR#vendor-1');
      expect(saved.SK).toMatch(/^STAFF#/);
      expect(saved.entityType).toBe('Staff');
    });

    it('associates an existing portal userId when explicitly provided', async () => {
      repository.findStaffByUserId.mockResolvedValue(null);
      repository.createStaff.mockResolvedValue(undefined);

      const result = await service.createvendorstaff(
        authRequest({
          body: {
            userId: 'portal-user-1',
            name: 'Ananya Reddy',
            phoneNumber: '+919900112233',
          },
        }),
      );

      expect(result.userId).toBe('portal-user-1');
      expect(repository.findStaffByUserId).toHaveBeenCalledWith(
        'vendor-1',
        'portal-user-1',
      );
    });

    it('rejects a duplicate portal identity on the same vendor', async () => {
      repository.findStaffByUserId.mockResolvedValue(staffItem({ userId: 'portal-user-1' }));

      await expect(
        service.createvendorstaff(
          authRequest({
            body: {
              userId: 'portal-user-1',
              name: 'Duplicate',
              phoneNumber: '+919900000000',
            },
          }),
        ),
      ).rejects.toThrow(ConflictError);
      expect(repository.createStaff).not.toHaveBeenCalled();
    });

    it('rejects staff creation when the caller is unauthenticated', async () => {
      await expect(
        service.createvendorstaff(
          authRequest({
            context: { userContext: {} },
            body: { name: 'Ananya Reddy', phoneNumber: '+919900112233' },
          }),
        ),
      ).rejects.toThrow(UnauthorizedError);
      expect(repository.createStaff).not.toHaveBeenCalled();
    });
  });

  describe('getvendorstaff', () => {
    it('returns a staff member owned by the vendor', async () => {
      repository.getStaff.mockResolvedValue(staffItem());

      const result = await service.getvendorstaff(
        authRequest({
          pathParameters: { vendorId: 'vendor-1', staffId: 'staff-1' },
          params: { vendorId: 'vendor-1', staffId: 'staff-1' },
        }),
      );

      expect(result.staffId).toBe('staff-1');
      expect(repository.getStaff).toHaveBeenCalledWith('vendor-1', 'staff-1');
    });

    it('returns 404 when staff is missing', async () => {
      repository.getStaff.mockResolvedValue(null);

      await expect(
        service.getvendorstaff(
          authRequest({
            pathParameters: { vendorId: 'vendor-1', staffId: 'missing' },
            params: { vendorId: 'vendor-1', staffId: 'missing' },
          }),
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('forbids access when the caller does not own the vendor', async () => {
      vendorsRepository.getVendorById.mockResolvedValue({
        ...vendorItem(),
        ownerUserId: 'someone-else',
      });

      await expect(
        service.getvendorstaff(
          authRequest({
            pathParameters: { vendorId: 'vendor-1', staffId: 'staff-1' },
            params: { vendorId: 'vendor-1', staffId: 'staff-1' },
          }),
        ),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('updatevendorstaff', () => {
    it('updates vendor staff profile fields', async () => {
      repository.getStaff.mockResolvedValue(staffItem());
      repository.updateStaff.mockResolvedValue(undefined);

      const result = await service.updatevendorstaff(
        authRequest({
          pathParameters: { vendorId: 'vendor-1', staffId: 'staff-1' },
          params: { vendorId: 'vendor-1', staffId: 'staff-1' },
          body: { role: 'LEAD_STYLIST', phoneNumber: '+919900112244' },
        }),
      );

      expect(result.role).toBe('LEAD_STYLIST');
      expect(result.phoneNumber).toBe('+919900112244');
      expect(result.userId).toBeUndefined();
    });
  });

  describe('deactivatevendorstaff', () => {
    it('soft-deletes staff by setting status INACTIVE', async () => {
      repository.getStaff.mockResolvedValue(staffItem());
      repository.updateStaff.mockResolvedValue(undefined);

      await service.deactivatevendorstaff(
        authRequest({
          pathParameters: { vendorId: 'vendor-1', staffId: 'staff-1' },
          params: { vendorId: 'vendor-1', staffId: 'staff-1' },
        }),
      );

      expect(repository.updateStaff).toHaveBeenCalledWith(
        expect.objectContaining({
          staffId: 'staff-1',
          status: 'INACTIVE',
        }),
      );
    });
  });
});
