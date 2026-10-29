import { LambdaRequest } from '@api-hub/utils';
import {
  ConflictError,
  ConditionalWriteConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';

import { CrewService } from './crew.service';
import { CrewRepository } from '../repositories/crew.repository';
import { StaffRepository } from '../repositories/staff.repository';
import { VendorsRepository } from '../repositories/vendors.repository';
import { CrewDdbItem, StaffDdbItem, VendorDdbItem } from '../types/repository.types';

function authRequest(overrides: Record<string, unknown> = {}): LambdaRequest {
  return {
    pathParameters: { vendorId: 'vendor-1', ...(overrides.pathParameters as object) },
    params: { vendorId: 'vendor-1', ...(overrides.params as object) },
    body: overrides.body,
    context: {
      userContext: { userId: 'user-1' },
      ...(overrides.context as object),
    },
    ...overrides,
  } as unknown as LambdaRequest;
}

function vendorItem(ownerUserId = 'user-1'): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'PROFILE',
    vendorId: 'vendor-1',
    ownerUserId,
    businessType: 'BUSINESS',
    businessName: 'Glow',
    contactName: 'Priya',
    phoneNumber: '+919876543210',
    onboardingStatus: 'IN_PROGRESS',
    currentSection: 'BRANCH',
    completedSections: [],
    addressCity: 'Kochi',
    addressPostalCode: '682030',
    status: 'ACTIVE',
    operationalStatus: 'ONLINE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    GSI1PK: 'VENDOR',
    GSI1SK: 'STATUS#ACTIVE',
    entityType: 'Vendor',
  };
}

function staff(staffId: string, status: StaffDdbItem['status'] = 'ACTIVE', vendorId = 'vendor-1'): StaffDdbItem {
  return {
    PK: `VENDOR#${vendorId}`,
    SK: `STAFF#${staffId}`,
    staffId,
    vendorId,
    name: staffId === 'staff-1' ? 'Rahul' : 'Meera',
    phoneNumber: '+919876543210',
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entityType: 'Staff',
  };
}

function crewItem(overrides: Partial<CrewDdbItem> = {}): CrewDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'CREW#crew-1',
    crewId: 'crew-1',
    vendorId: 'vendor-1',
    name: 'Morning Crew A',
    vanLabel: 'Van KL-07-AB-1234',
    staffIds: ['staff-1', 'staff-2'],
    status: 'ACTIVE',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entityType: 'Crew',
    ...overrides,
  };
}

describe('CrewService', () => {
  let repository: jest.Mocked<CrewRepository>;
  let vendorsRepository: jest.Mocked<VendorsRepository>;
  let staffRepository: jest.Mocked<StaffRepository>;
  let service: CrewService;

  beforeEach(() => {
    repository = {
      createCrew: jest.fn(),
      getCrew: jest.fn(),
      listCrews: jest.fn(),
      listAllCrews: jest.fn().mockResolvedValue([]),
      updateCrew: jest.fn(),
    } as unknown as jest.Mocked<CrewRepository>;
    vendorsRepository = {
      getVendorById: jest.fn().mockResolvedValue(vendorItem()),
    } as unknown as jest.Mocked<VendorsRepository>;
    staffRepository = {
      getStaff: jest.fn(async (_vendorId: string, staffId: string) => {
        if (staffId === 'staff-1' || staffId === 'staff-2') return staff(staffId);
        if (staffId === 'inactive') return staff('inactive', 'INACTIVE');
        return null;
      }),
      listAllStaff: jest.fn().mockResolvedValue([staff('staff-1'), staff('staff-2')]),
      listMembershipsByUserId: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<StaffRepository>;
    service = new CrewService(repository, vendorsRepository, staffRepository);
  });

  const body = {
    name: 'Morning Crew A',
    vanLabel: 'Van KL-07-AB-1234',
    staffIds: ['staff-1', 'staff-2'],
  };

  it('creates a crew of two active staff and persists staff ids', async () => {
    repository.createCrew.mockResolvedValue(undefined);

    const result = await service.createvendorcrew(authRequest({ body }));

    expect(result.staffIds).toEqual(['staff-1', 'staff-2']);
    expect(result.members.map((member) => member.name)).toEqual(['Rahul', 'Meera']);
    expect(result.status).toBe('ACTIVE');
    expect(result.revision).toBe(1);
    const saved = repository.createCrew.mock.calls[0][0];
    expect(saved.PK).toBe('VENDOR#vendor-1');
    expect(saved.SK).toMatch(/^CREW#/);
    expect(saved.staffIds).toEqual(['staff-1', 'staff-2']);
    expect(saved.entityType).toBe('Crew');
  });

  it('rejects fewer than two members, duplicates, missing staff, inactive staff, and another vendor', async () => {
    await expect(service.createvendorcrew(authRequest({
      body: { ...body, staffIds: ['staff-1'] },
    }))).rejects.toThrow(ValidationError);

    await expect(service.createvendorcrew(authRequest({
      body: { ...body, staffIds: ['staff-1', 'staff-1'] },
    }))).rejects.toThrow(/same staff member/);

    await expect(service.createvendorcrew(authRequest({
      body: { ...body, staffIds: ['staff-1', 'missing'] },
    }))).rejects.toThrow(/belong to this vendor/);

    await expect(service.createvendorcrew(authRequest({
      body: { ...body, staffIds: ['staff-1', 'inactive'] },
    }))).rejects.toThrow(/Inactive staff/);

    expect(repository.createCrew).not.toHaveBeenCalled();
  });

  it('lists and reads only crews in the requested vendor', async () => {
    repository.listCrews.mockResolvedValue({ items: [crewItem()] });
    repository.getCrew.mockResolvedValue(crewItem());

    const list = await service.listvendorcrews(authRequest());
    expect(list.data).toHaveLength(1);
    expect(list.data?.[0].members[0]).toEqual({ staffId: 'staff-1', name: 'Rahul', status: 'ACTIVE' });

    const detail = await service.getvendorcrew(authRequest({
      pathParameters: { vendorId: 'vendor-1', crewId: 'crew-1' },
      params: { vendorId: 'vendor-1', crewId: 'crew-1' },
    }));
    expect(detail.crewId).toBe('crew-1');
  });

  it('returns 404 for a crew that is not in this vendor partition', async () => {
    repository.getCrew.mockResolvedValue(null);
    await expect(service.getvendorcrew(authRequest({
      pathParameters: { vendorId: 'vendor-1', crewId: 'other' },
      params: { vendorId: 'vendor-1', crewId: 'other' },
    }))).rejects.toThrow(NotFoundError);
  });

  it('updates membership and rejects a stale revision', async () => {
    repository.getCrew.mockResolvedValue(crewItem());
    repository.updateCrew.mockResolvedValue(undefined);

    const updated = await service.updatevendorcrew(authRequest({
      pathParameters: { vendorId: 'vendor-1', crewId: 'crew-1' },
      params: { vendorId: 'vendor-1', crewId: 'crew-1' },
      body: { vanLabel: 'Van KL-07-ZZ-9999', revision: 1 },
    }));
    expect(updated.vanLabel).toBe('Van KL-07-ZZ-9999');
    expect(updated.revision).toBe(2);
    expect(repository.updateCrew).toHaveBeenCalledWith(
      expect.objectContaining({ staffIds: ['staff-1', 'staff-2'] }),
      1,
    );

    await expect(service.updatevendorcrew(authRequest({
      pathParameters: { vendorId: 'vendor-1', crewId: 'crew-1' },
      params: { vendorId: 'vendor-1', crewId: 'crew-1' },
      body: { name: 'Evening Crew', revision: 0 },
    }))).rejects.toThrow(ConflictError);
  });

  it('turns a conditional write conflict into a conflict response', async () => {
    repository.getCrew.mockResolvedValue(crewItem());
    repository.updateCrew.mockRejectedValue(new ConditionalWriteConflictError(new Error('conflict')));

    await expect(service.updatevendorcrew(authRequest({
      pathParameters: { vendorId: 'vendor-1', crewId: 'crew-1' },
      params: { vendorId: 'vendor-1', crewId: 'crew-1' },
      body: { name: 'Evening Crew' },
    }))).rejects.toThrow(ConflictError);
  });

  it('deactivates a crew without deleting the record', async () => {
    repository.getCrew.mockResolvedValue(crewItem());
    repository.updateCrew.mockResolvedValue(undefined);

    await service.deactivatevendorcrew(authRequest({
      pathParameters: { vendorId: 'vendor-1', crewId: 'crew-1' },
      params: { vendorId: 'vendor-1', crewId: 'crew-1' },
    }));

    expect(repository.updateCrew).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'INACTIVE', staffIds: ['staff-1', 'staff-2'] }),
      1,
    );
  });

  it('denies a staff caller who tries to change a crew, including another vendor', async () => {
    vendorsRepository.getVendorById.mockResolvedValue(vendorItem('owner-2'));
    staffRepository.listMembershipsByUserId.mockResolvedValue([{
      PK: 'STAFF_USER#user-1',
      SK: 'VENDOR#vendor-9',
      userId: 'user-1',
      vendorId: 'vendor-9',
      staffId: 'staff-9',
      status: 'ACTIVE',
      entityType: 'StaffMembership',
    }]);

    await expect(service.createvendorcrew(authRequest({ body }))).rejects.toThrow(ForbiddenError);
    expect(repository.createCrew).not.toHaveBeenCalled();
  });

  it('denies an inactive membership even when the token includes crew:view', async () => {
    vendorsRepository.getVendorById.mockResolvedValue(vendorItem('owner-2'));
    staffRepository.listMembershipsByUserId.mockResolvedValue([{
      PK: 'STAFF_USER#user-1',
      SK: 'VENDOR#vendor-1',
      userId: 'user-1',
      vendorId: 'vendor-1',
      staffId: 'staff-9',
      status: 'INACTIVE',
      entityType: 'StaffMembership',
    }]);

    await expect(service.listvendorcrews(authRequest({
      context: {
        userContext: { userId: 'user-1' },
        authContext: { identityId: 'sub', userId: 'user-1', roles: [], permissions: ['crew:view'], claims: {} },
      },
    }))).rejects.toThrow(ForbiddenError);
  });
});
