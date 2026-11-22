jest.mock('../events/publish-staff-account-provisioning', () => ({
  publishStaffAccountProvisioningRequested: jest.fn().mockResolvedValue(undefined),
}));

import { LambdaRequest } from '@api-hub/utils';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '@api-hub/utils';

import { ValidationError } from '@api-hub/utils';

import { publishStaffAccountProvisioningRequested } from '../events/publish-staff-account-provisioning';
import { StaffService } from './staff.service';
import { CrewRepository } from '../repositories/crew.repository';
import { StaffRepository } from '../repositories/staff.repository';
import { VendorsRepository } from '../repositories/vendors.repository';
import { CrewDdbItem, StaffDdbItem, VendorDdbItem } from '../types/repository.types';

const publishProvisioning = publishStaffAccountProvisioningRequested as jest.MockedFunction<
  typeof publishStaffAccountProvisioningRequested
>;

function authRequest(overrides: Record<string, unknown> = {}): LambdaRequest {
  const overrideContext = (overrides.context ?? {}) as Record<string, unknown>;
  const overrideAuth = (overrideContext.authContext ?? {}) as Record<string, unknown>;
  const overrideUser = (overrideContext.userContext ?? {}) as Record<string, unknown>;
  return {
    pathParameters: { vendorId: 'vendor-1', ...(overrides.pathParameters as object) },
    params: { vendorId: 'vendor-1', ...(overrides.params as object) },
    body: overrides.body,
    ...overrides,
    context: {
      ...overrideContext,
      userContext: { userId: 'user-1', ...overrideUser },
      authContext: {
        identityId: 'identity-1',
        userId: 'user-1',
        roles: ['VENDOR'],
        permissions: [],
        claims: {},
        ...overrideAuth,
      },
    },
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
  let crews: jest.Mocked<CrewRepository>;
  let service: StaffService;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = {
      createStaff: jest.fn(),
      getStaff: jest.fn(),
      listStaff: jest.fn(),
      findStaffByUserId: jest.fn(),
      findStaffByPhone: jest.fn().mockResolvedValue(null),
      listMembershipsByUserId: jest.fn().mockResolvedValue([]),
      updateStaff: jest.fn(),
      deactivateStaff: jest.fn(),
    } as unknown as jest.Mocked<StaffRepository>;

    vendorsRepository = {
      getVendorById: jest.fn().mockResolvedValue(vendorItem()),
    } as unknown as jest.Mocked<VendorsRepository>;

    crews = {
      listAllCrews: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<CrewRepository>;

    service = new StaffService(repository, vendorsRepository, crews);
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
    it('creates a PENDING BUDDY staff record and requests account provisioning', async () => {
      repository.createStaff.mockResolvedValue(undefined);

      const result = await service.createvendorstaff(
        authRequest({
          body: {
            name: 'Ananya Reddy',
            phoneNumber: '+919900112233',
          },
        }),
      );

      expect(result.userId).toBeUndefined();
      expect(result.vendorId).toBe('vendor-1');
      expect(result.status).toBe('ACTIVE');
      expect(result.role).toBe('BUDDY');
      expect(result.provisioningStatus).toBe('PENDING');
      expect(result.email).toBeUndefined();
      const saved = repository.createStaff.mock.calls[0][0];
      expect(saved.userId).toBeUndefined();
      expect(saved.role).toBe('BUDDY');
      expect(saved.provisioningStatus).toBe('PENDING');
      expect(saved.PK).toBe('VENDOR#vendor-1');
      expect(saved.SK).toMatch(/^STAFF#/);
      expect(saved.entityType).toBe('Staff');
      expect(publishProvisioning).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorId: 'vendor-1',
          phoneNumber: '+919900112233',
          displayName: 'Ananya Reddy',
          staffId: expect.any(String),
        }),
        expect.any(String),
      );
    });

    it('rejects an invalid Indian mobile number', async () => {
      await expect(
        service.createvendorstaff(
          authRequest({ body: { name: 'Ananya Reddy', phoneNumber: '12345' } }),
        ),
      ).rejects.toThrow(ValidationError);
      expect(repository.createStaff).not.toHaveBeenCalled();
    });

    it('rejects a duplicate mobile number for the vendor', async () => {
      repository.findStaffByPhone.mockResolvedValue(staffItem());

      await expect(
        service.createvendorstaff(
          authRequest({ body: { name: 'Another Person', phoneNumber: '9900112233' } }),
        ),
      ).rejects.toThrow(ConflictError);
      expect(repository.createStaff).not.toHaveBeenCalled();
    });

    it('stores the mobile number in E.164 form', async () => {
      repository.createStaff.mockResolvedValue(undefined);

      const result = await service.createvendorstaff(
        authRequest({ body: { name: 'Ananya Reddy', phoneNumber: '9900112233' } }),
      );

      expect(result.phoneNumber).toBe('+919900112233');
      expect(result.status).toBe('ACTIVE');
    });

    it('denies staff creation for a REGISTRANT who owns the vendor', async () => {
      await expect(
        service.createvendorstaff(
          authRequest({
            body: { name: 'Ananya Reddy', phoneNumber: '+919900112233' },
            context: {
              authContext: {
                identityId: 'sub-1',
                userId: 'user-1',
                roles: ['REGISTRANT'],
                permissions: ['vendor:register'],
                claims: {},
              },
              userContext: { userId: 'user-1', roles: ['VENDOR'], permissions: ['staff:manage'] },
            },
          }),
        ),
      ).rejects.toThrow(ForbiddenError);
      expect(repository.createStaff).not.toHaveBeenCalled();
    });

    it('rejects staff creation when the caller is unauthenticated', async () => {
      await expect(
        service.createvendorstaff(
          authRequest({
            context: {
              userContext: {},
              authContext: {
                identityId: undefined,
                userId: undefined,
                roles: [],
                permissions: [],
                claims: {},
              },
            },
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
    it('updates the staff display name only', async () => {
      repository.getStaff.mockResolvedValue(staffItem({ role: 'BUDDY' }));
      repository.updateStaff.mockResolvedValue(undefined);

      const result = await service.updatevendorstaff(
        authRequest({
          pathParameters: { vendorId: 'vendor-1', staffId: 'staff-1' },
          params: { vendorId: 'vendor-1', staffId: 'staff-1' },
          body: { name: 'Ananya Updated' },
        }),
      );

      expect(result.name).toBe('Ananya Updated');
      expect(result.role).toBe('BUDDY');
      expect(result.phoneNumber).toBe('+919900112233');
      expect(result.userId).toBeUndefined();
    });
  });

  describe('deactivatevendorstaff', () => {
    it('soft-deletes staff by setting status INACTIVE', async () => {
      repository.getStaff.mockResolvedValue(staffItem());
      repository.deactivateStaff = jest.fn().mockResolvedValue(undefined);

      await service.deactivatevendorstaff(
        authRequest({
          pathParameters: { vendorId: 'vendor-1', staffId: 'staff-1' },
          params: { vendorId: 'vendor-1', staffId: 'staff-1' },
        }),
      );

      expect(repository.deactivateStaff).toHaveBeenCalledWith(
        expect.objectContaining({
          staffId: 'staff-1',
          status: 'ACTIVE',
        }),
      );
    });

    it('rejects deactivation while the staff member is on an active crew', async () => {
      repository.getStaff.mockResolvedValue(staffItem());
      crews.listAllCrews.mockResolvedValue([{
        PK: 'VENDOR#vendor-1',
        SK: 'CREW#crew-1',
        crewId: 'crew-1',
        vendorId: 'vendor-1',
        name: 'Morning Crew A',
        vanLabel: 'Van KL-07',
        staffIds: ['staff-1', 'staff-2'],
        status: 'ACTIVE',
        revision: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        entityType: 'Crew',
      } satisfies CrewDdbItem]);

      await expect(
        service.deactivatevendorstaff(
          authRequest({
            pathParameters: { vendorId: 'vendor-1', staffId: 'staff-1' },
            params: { vendorId: 'vendor-1', staffId: 'staff-1' },
          }),
        ),
      ).rejects.toThrow(ConflictError);
      expect(repository.updateStaff).not.toHaveBeenCalled();
    });

    it('allows an active BUDDY with membership to read, and denies management', async () => {
      repository.getStaff.mockResolvedValue(staffItem());
      repository.listMembershipsByUserId.mockResolvedValue([{
        PK: 'STAFF_USER#buddy-user',
        SK: 'VENDOR#vendor-1',
        userId: 'buddy-user',
        vendorId: 'vendor-1',
        staffId: 'staff-9',
        status: 'ACTIVE',
        entityType: 'StaffMembership',
      }]);
      vendorsRepository.getVendorById.mockResolvedValue({
        ...vendorItem(),
        ownerUserId: 'someone-else',
      });
      const reader = authRequest({
        context: {
          userContext: { userId: 'buddy-user' },
          authContext: {
            identityId: 'sub',
            userId: 'buddy-user',
            roles: ['BUDDY'],
            permissions: [],
            claims: {},
          },
        },
        pathParameters: { vendorId: 'vendor-1', staffId: 'staff-1' },
        params: { vendorId: 'vendor-1', staffId: 'staff-1' },
      });

      await expect(service.getvendorstaff(reader)).resolves.toMatchObject({ staffId: 'staff-1' });
      await expect(
        service.deactivatevendorstaff(reader),
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
