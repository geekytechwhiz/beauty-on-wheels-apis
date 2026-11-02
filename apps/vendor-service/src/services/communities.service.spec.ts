import { LambdaRequest } from '@api-hub/utils';
import {
  ConditionalWriteConflictError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';

import { CommunitiesService } from './communities.service';
import { CommunitiesRepository, CommunityDirectoryItem } from '../repositories/communities.repository';
import { StaffRepository } from '../repositories/staff.repository';
import { VendorsRepository } from '../repositories/vendors.repository';
import { VendorCommunityDdbItem, VendorDdbItem } from '../types/repository.types';

function authRequest(overrides: Record<string, unknown> = {}): LambdaRequest {
  return {
    pathParameters: { vendorId: 'vendor-1' },
    params: { vendorId: 'vendor-1', ...(overrides.params as object) },
    body: overrides.body,
    context: {
      userContext: { userId: 'user-1' },
      authContext: { userId: 'user-1', roles: [], permissions: [], claims: {} },
      ...(overrides.context as object),
    },
  } as unknown as LambdaRequest;
}

function vendorItem(ownerUserId = 'user-1', updatedAt = '2026-01-01T00:00:00.000Z'): VendorDdbItem {
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
    updatedAt,
    GSI1PK: 'VENDOR',
    GSI1SK: 'STATUS#ACTIVE',
    entityType: 'Vendor',
  };
}

function directory(communityId: string, status = 'ACTIVE'): CommunityDirectoryItem {
  return {
    PK: `COMMUNITY#${communityId}`,
    SK: 'META',
    communityId,
    name: `${communityId} name`,
    cityId: 'KOCHI',
    cityName: 'Kochi',
    localityId: 'KAKKANAD',
    localityName: 'Kakkanad',
    postalCode: '682030',
    directoryStatus: status,
    searchText: `${communityId} kochi kakkanad 682030`,
  };
}

function assignment(
  communityId: string,
  approvalStatus: VendorCommunityDdbItem['approvalStatus'] = 'REQUESTED',
): VendorCommunityDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: `COMMUNITY#${communityId}`,
    vendorId: 'vendor-1',
    communityId,
    assignedBy: 'user-1',
    assignedAt: '2026-01-02T00:00:00.000Z',
    status: 'ACTIVE',
    operationalStatus: 'ONLINE',
    approvalStatus,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    GSI3PK: `COMMUNITY#${communityId}`,
    GSI3SK: 'STATUS#ACTIVE#vendor-1',
    entityType: 'VendorCommunity',
  };
}

describe('partner community directory and coverage', () => {
  let communitiesRepository: jest.Mocked<CommunitiesRepository>;
  let vendorsRepository: jest.Mocked<VendorsRepository>;
  let staffRepository: jest.Mocked<Pick<StaffRepository, 'listMembershipsByUserId'>>;
  let service: CommunitiesService;

  beforeEach(() => {
    communitiesRepository = {
      listCommunities: jest.fn(),
      getDirectoryCommunity: jest.fn(),
      getActiveCommunity: jest.fn(),
      listByVendor: jest.fn().mockResolvedValue([]),
      getCoverage: jest.fn(),
      writeCoverageDecision: jest.fn().mockResolvedValue(undefined),
      assertApprovedCoverage: jest.fn(),
    } as unknown as jest.Mocked<CommunitiesRepository>;
    vendorsRepository = {
      getVendorById: jest.fn().mockResolvedValue(vendorItem()),
      transactVendorProfile: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VendorsRepository>;
    staffRepository = { listMembershipsByUserId: jest.fn().mockResolvedValue([]) };
    service = new CommunitiesService(
      communitiesRepository,
      vendorsRepository,
      staffRepository as unknown as StaffRepository,
    );
  });

  it('searches active communities with the directory filters and an opaque cursor', async () => {
    communitiesRepository.listCommunities.mockResolvedValue({
      items: [directory('com-1')],
      lastEvaluatedKey: { PK: 'COMMUNITY_ALL#STATUS#ACTIVE', SK: 'NAME#com-1' },
    });

    const result = await service.listPartnerCommunityDirectory(authRequest({
      params: { search: 'Kakkanad', cityId: 'KOCHI', postalCode: '682030', limit: '20' },
    }));

    expect(communitiesRepository.listCommunities).toHaveBeenCalledWith(expect.objectContaining({
      search: 'Kakkanad',
      cityId: 'KOCHI',
      postalCode: '682030',
      limit: 20,
    }));
    expect(result.data.items).toEqual([{
      communityId: 'com-1',
      name: 'com-1 name',
      cityId: 'KOCHI',
      cityName: 'Kochi',
      localityId: 'KAKKANAD',
      localityName: 'Kakkanad',
      postalCode: '682030',
    }]);
    expect(result.data.pagination.hasMore).toBe(true);
    expect(result.data.pagination.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(result.data)).not.toMatch(/searchText|assignedBy|"PK"/);
  });

  it('lets visits:view staff resolve ids and refuses a directory browse', async () => {
    vendorsRepository.getVendorById.mockResolvedValue(vendorItem('owner-2'));
    staffRepository.listMembershipsByUserId.mockResolvedValue([{
      PK: 'STAFF_USER#user-1',
      SK: 'VENDOR#vendor-1',
      userId: 'user-1',
      vendorId: 'vendor-1',
      staffId: 'staff-1',
      status: 'ACTIVE',
      entityType: 'StaffMembership',
    }]);
    communitiesRepository.getDirectoryCommunity.mockImplementation(async (id: string) => (
      id === 'com-1' ? directory('com-1') : id === 'gone' ? directory('gone', 'INACTIVE') : null
    ));
    const staffRequest = {
      context: {
        userContext: { userId: 'user-1' },
        authContext: { userId: 'user-1', roles: [], permissions: ['visits:view'], claims: {} },
      },
    };

    await expect(service.listPartnerCommunityDirectory(authRequest(staffRequest))).rejects.toThrow(ForbiddenError);
    const lookup = await service.listPartnerCommunityDirectory(authRequest({
      ...staffRequest,
      params: { ids: 'com-1,gone,missing' },
    }));

    expect(lookup.data.items.map((item) => item.communityId)).toEqual(['com-1']);
    expect(communitiesRepository.listCommunities).not.toHaveBeenCalled();
    await expect(service.replacePartnerCommunityCoverage(authRequest({
      ...staffRequest,
      body: { communityIds: ['com-1'], expectedUpdatedAt: '2026-01-01T00:00:00.000Z' },
    }))).rejects.toThrow(ForbiddenError);
    expect(vendorsRepository.transactVendorProfile).not.toHaveBeenCalled();
  });

  it('refuses coverage for a different vendor and an inactive membership', async () => {
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
    const permissions = {
      context: {
        userContext: { userId: 'user-1' },
        authContext: { userId: 'user-1', roles: [], permissions: ['communities:view', 'communities:manage'], claims: {} },
      },
    };

    await expect(service.getPartnerCommunityCoverage(authRequest(permissions))).rejects.toThrow(ForbiddenError);

    staffRepository.listMembershipsByUserId.mockResolvedValue([{
      PK: 'STAFF_USER#user-1',
      SK: 'VENDOR#vendor-1',
      userId: 'user-1',
      vendorId: 'vendor-1',
      staffId: 'staff-1',
      status: 'INACTIVE',
      entityType: 'StaffMembership',
    }]);
    await expect(service.replacePartnerCommunityCoverage(authRequest({
      ...permissions,
      body: { communityIds: ['com-1'], expectedUpdatedAt: '2026-01-01T00:00:00.000Z' },
    }))).rejects.toThrow(ForbiddenError);
    expect(vendorsRepository.transactVendorProfile).not.toHaveBeenCalled();
  });

  it('rejects unknown and inactive communities before replacing coverage', async () => {
    communitiesRepository.getDirectoryCommunity.mockResolvedValue(null);
    await expect(service.replacePartnerCommunityCoverage(authRequest({
      body: { communityIds: ['missing'], expectedUpdatedAt: '2026-01-01T00:00:00.000Z' },
    }))).rejects.toThrow(ValidationError);

    communitiesRepository.getDirectoryCommunity.mockResolvedValue(directory('paused', 'INACTIVE'));
    await expect(service.replacePartnerCommunityCoverage(authRequest({
      body: { communityIds: ['paused'], expectedUpdatedAt: '2026-01-01T00:00:00.000Z' },
    }))).rejects.toThrow(/inactive/i);
    expect(vendorsRepository.transactVendorProfile).not.toHaveBeenCalled();
  });

  it('rejects a stale coverage timestamp and replaces an active set for a permitted manager', async () => {
    await expect(service.replacePartnerCommunityCoverage(authRequest({
      body: { communityIds: ['com-1'], expectedUpdatedAt: '1999-01-01T00:00:00.000Z' },
    }))).rejects.toThrow(ConflictError);
    expect(communitiesRepository.getDirectoryCommunity).not.toHaveBeenCalled();

    vendorsRepository.getVendorById.mockResolvedValue(vendorItem('owner-2'));
    staffRepository.listMembershipsByUserId.mockResolvedValue([{
      PK: 'STAFF_USER#user-1',
      SK: 'VENDOR#vendor-1',
      userId: 'user-1',
      vendorId: 'vendor-1',
      staffId: 'staff-1',
      status: 'ACTIVE',
      entityType: 'StaffMembership',
    }]);
    communitiesRepository.getDirectoryCommunity.mockResolvedValue(directory('com-1'));
    communitiesRepository.listByVendor
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([assignment('com-1')])
      .mockResolvedValueOnce([assignment('com-1')]);
    vendorsRepository.getVendorById
      .mockResolvedValueOnce(vendorItem('owner-2'))
      .mockResolvedValueOnce(vendorItem('owner-2'))
      .mockResolvedValueOnce(vendorItem('owner-2', '2026-01-02T00:00:00.000Z'));

    const saved = await service.replacePartnerCommunityCoverage(authRequest({
      context: {
        userContext: { userId: 'user-1' },
        authContext: { userId: 'user-1', roles: [], permissions: ['communities:manage'], claims: {} },
      },
      body: { communityIds: ['com-1'], expectedUpdatedAt: '2026-01-01T00:00:00.000Z' },
    }));

    expect(vendorsRepository.transactVendorProfile).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
    }));
    expect(saved.data.communityIds).toEqual(['com-1']);
    expect(saved.data.communities[0]?.name).toBe('com-1 name');
    expect(saved.data.communities[0]).toMatchObject({
      approvalStatus: 'REQUESTED',
      approvalStatusLabel: 'Requested',
    });
    const written = vendorsRepository.transactVendorProfile.mock.calls[0][0];
    expect(written.puts?.map((put) => (put.item as VendorCommunityDdbItem).approvalStatus)).toEqual(['REQUESTED']);
    expect(JSON.stringify(saved.data)).not.toMatch(/assignedBy/);
  });

  it('keeps the customer community list on its existing repository response', async () => {
    const page = { items: [directory('com-1')], lastEvaluatedKey: undefined };
    communitiesRepository.listCommunities.mockResolvedValue(page);
    const result = await service.listcommunities({ query: { search: 'Kochi' } } as unknown as LambdaRequest);
    expect(result.data).toBe(page);
    expect(vendorsRepository.getVendorById).not.toHaveBeenCalled();
  });

  it('keeps approved communities that stay, starts new ones as REQUESTED, and deletes removed ones', async () => {
    communitiesRepository.getDirectoryCommunity.mockImplementation(async (id: string) => directory(id));
    communitiesRepository.listByVendor
      .mockResolvedValueOnce([assignment('keep', 'APPROVED'), assignment('drop', 'APPROVED')])
      .mockResolvedValueOnce([assignment('keep', 'APPROVED'), assignment('fresh', 'REQUESTED')])
      .mockResolvedValue([assignment('keep', 'APPROVED'), assignment('fresh', 'REQUESTED')]);

    const saved = await service.replacePartnerCommunityCoverage(authRequest({
      body: { communityIds: ['keep', 'fresh'], expectedUpdatedAt: '2026-01-01T00:00:00.000Z' },
    }));

    const call = vendorsRepository.transactVendorProfile.mock.calls[0][0];
    // Only the new row is written. The approved row that stays is never rewritten.
    expect(call.puts).toHaveLength(1);
    expect(call.puts?.[0].item).toMatchObject({
      communityId: 'fresh',
      approvalStatus: 'REQUESTED',
    });
    expect(call.puts?.map((put) => (put.item as VendorCommunityDdbItem).approvalStatus)).not.toContain('APPROVED');
    expect(call.deletes).toEqual([{ PK: 'VENDOR#vendor-1', SK: 'COMMUNITY#drop' }]);
    expect(Object.fromEntries(saved.data.communities.map((c) => [c.communityId, c.approvalStatus])))
      .toEqual({ keep: 'APPROVED', fresh: 'REQUESTED' });
  });

  it('reads legacy rows without approvalStatus as PENDING, never APPROVED', async () => {
    const legacy = assignment('old');
    delete legacy.approvalStatus;
    communitiesRepository.listByVendor.mockResolvedValue([legacy]);
    communitiesRepository.getDirectoryCommunity.mockResolvedValue(directory('old'));

    const result = await service.getPartnerCommunityCoverage(authRequest());

    expect(result.data.communities[0]).toMatchObject({
      approvalStatus: 'PENDING',
      approvalStatusLabel: 'Pending review',
      name: 'old name',
    });
    const assignments = await service.listvendorcommunities(authRequest());
    expect(assignments.data[0].approvalStatus).toBe('PENDING');
  });

  describe('coverage approval', () => {
    const adminRequest = (body: unknown) => authRequest({
      pathParameters: { vendorId: 'vendor-1', communityId: 'com-1' },
      params: { vendorId: 'vendor-1', communityId: 'com-1' },
      body,
      context: {
        userContext: { userId: 'admin-1', roles: ['admin'], permissions: [] },
        authContext: { userId: 'admin-1', roles: ['admin'], permissions: [], claims: {} },
      },
    });

    it('lets only an admin decide, and records actor, time, reason and a history row', async () => {
      communitiesRepository.getCoverage.mockResolvedValue(assignment('com-1', 'REQUESTED'));

      await expect(service.updatecommunitycoverageapproval(authRequest({
        pathParameters: { vendorId: 'vendor-1', communityId: 'com-1' },
        body: { status: 'APPROVED' },
      }))).rejects.toThrow(ForbiddenError);
      expect(communitiesRepository.writeCoverageDecision).not.toHaveBeenCalled();

      const result = await service.updatecommunitycoverageapproval(
        adminRequest({ status: 'APPROVED', reason: 'Gate access confirmed' }),
      );

      const write = communitiesRepository.writeCoverageDecision.mock.calls[0][0];
      expect(write.expectedUpdatedAt).toBe('2026-01-02T00:00:00.000Z');
      expect(write.item).toMatchObject({
        approvalStatus: 'APPROVED',
        approvalUpdatedBy: 'admin-1',
        approvalReason: 'Gate access confirmed',
      });
      expect(write.history).toMatchObject({
        fromStatus: 'REQUESTED',
        toStatus: 'APPROVED',
        actorUserId: 'admin-1',
        reason: 'Gate access confirmed',
      });
      expect(write.history.SK).toMatch(/^COVERAGE_HISTORY#com-1#/);
      expect(result.data).toMatchObject({
        communityId: 'com-1',
        approvalStatus: 'APPROVED',
        approvalUpdatedBy: 'admin-1',
      });
      expect(result.data.historyEntry?.toStatus).toBe('APPROVED');
    });

    it('is idempotent for the same status and 404s for a community the vendor does not cover', async () => {
      communitiesRepository.getCoverage.mockResolvedValue(assignment('com-1', 'SUSPENDED'));
      const same = await service.updatecommunitycoverageapproval(adminRequest({ status: 'SUSPENDED' }));
      expect(same.data.approvalStatus).toBe('SUSPENDED');
      expect(communitiesRepository.writeCoverageDecision).not.toHaveBeenCalled();

      communitiesRepository.getCoverage.mockResolvedValue(null);
      await expect(service.updatecommunitycoverageapproval(adminRequest({ status: 'APPROVED' })))
        .rejects.toThrow(NotFoundError);
    });

    it('turns a lost write race into a 409', async () => {
      communitiesRepository.getCoverage.mockResolvedValue(assignment('com-1', 'REQUESTED'));
      communitiesRepository.writeCoverageDecision.mockRejectedValue(
        new ConditionalWriteConflictError(new Error('conflict')),
      );
      await expect(service.updatecommunitycoverageapproval(adminRequest({ status: 'REJECTED' })))
        .rejects.toThrow(ConflictError);
    });
  });

  describe('assertApprovedCoverage', () => {
    it('passes only for APPROVED coverage', async () => {
      const real = new CommunitiesRepository();
      const lookup = jest.spyOn(real, 'getCoverage');

      lookup.mockResolvedValue(assignment('com-1', 'APPROVED'));
      await expect(real.assertApprovedCoverage('vendor-1', 'com-1')).resolves.toMatchObject({
        communityId: 'com-1',
      });

      for (const status of ['REQUESTED', 'PENDING', 'REJECTED', 'SUSPENDED'] as const) {
        lookup.mockResolvedValue(assignment('com-1', status));
        await expect(real.assertApprovedCoverage('vendor-1', 'com-1')).rejects.toThrow(ConflictError);
      }
      const legacy = assignment('com-1');
      delete legacy.approvalStatus;
      lookup.mockResolvedValue(legacy);
      await expect(real.assertApprovedCoverage('vendor-1', 'com-1')).rejects.toThrow(ConflictError);
      lookup.mockResolvedValue(null);
      await expect(real.assertApprovedCoverage('vendor-1', 'com-1')).rejects.toThrow(ConflictError);
    });

    it('is exposed on the service', async () => {
      communitiesRepository.assertApprovedCoverage.mockResolvedValue(assignment('com-1', 'APPROVED'));
      await service.assertApprovedCoverage('vendor-1', 'com-1');
      expect(communitiesRepository.assertApprovedCoverage).toHaveBeenCalledWith('vendor-1', 'com-1');
    });
  });
});
