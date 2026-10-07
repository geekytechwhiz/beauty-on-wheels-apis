import { ForbiddenError, LambdaRequest, ValidationError } from '@api-hub/utils';

import { CommunitiesService } from './communities.service';
import { CommunitiesRepository } from '../repositories/communities.repository';
import { CustomersRepository } from '../repositories/customers.repository';
import { CommunityRecord, CustomerProfileRecord } from '../types/records';

function request(overrides: Record<string, unknown> = {}): LambdaRequest {
  const context = {
    userContext: { userId: 'admin-1', roles: ['admin'] },
    ...(overrides.context as object),
  };
  return {
    pathParameters: { userId: 'user-1', ...(overrides.pathParameters as object) },
    params: { userId: 'user-1', ...(overrides.params as object) },
    body: {},
    ...overrides,
    context,
  } as unknown as LambdaRequest;
}

function community(status: 'active' | 'inactive' = 'active'): CommunityRecord {
  return {
    PK: 'COMMUNITY#community-1',
    SK: 'META',
    entityType: 'Community',
    communityId: 'community-1',
    name: 'Kochi Central',
    status,
    GSI1PK: 'COMMUNITY',
    GSI1SK: '2026-01-01T00:00:00.000Z#community-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('CommunitiesService', () => {
  let communities: jest.Mocked<
    Pick<
      CommunitiesRepository,
      | 'createCommunity'
      | 'getCommunity'
      | 'saveCommunity'
      | 'listCommunities'
      | 'listMemberships'
      | 'replaceMemberships'
    >
  >;
  let customers: jest.Mocked<Pick<CustomersRepository, 'getProfile'>>;
  let service: CommunitiesService;

  beforeEach(() => {
    communities = {
      createCommunity: jest.fn().mockResolvedValue(undefined),
      getCommunity: jest.fn().mockResolvedValue(community()),
      saveCommunity: jest.fn().mockResolvedValue(undefined),
      listCommunities: jest.fn().mockResolvedValue({ items: [community()] }),
      listMemberships: jest.fn().mockResolvedValue([
        {
          PK: 'USER#user-1',
          SK: 'MEMBER#community-1',
          entityType: 'CommunityMembership',
          userId: 'user-1',
          communityId: 'community-1',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
      replaceMemberships: jest.fn().mockResolvedValue(undefined),
    };
    customers = {
      getProfile: jest.fn().mockResolvedValue({
        userId: 'user-1',
        communityIds: ['community-1'],
      } as CustomerProfileRecord),
    };
    service = new CommunitiesService(
      communities as unknown as CommunitiesRepository,
      customers as unknown as CustomersRepository,
    );
  });

  it('requires an admin to create a community', async () => {
    await expect(
      service.createCommunity(
        request({
          body: { name: 'Kochi Central' },
          context: { userContext: { userId: 'user-1', roles: ['customer'] } },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('creates an active community for an admin', async () => {
    const created = await service.createCommunity(
      request({ body: { name: 'Kochi Central', city: 'Kochi' } }),
    );

    expect(created.status).toBe('active');
    expect(created.name).toBe('Kochi Central');
    expect(communities.createCommunity).toHaveBeenCalled();
  });

  it('replaces membership and drops communities that were removed', async () => {
    communities.getCommunity.mockImplementation(async (communityId: string) => {
      if (communityId === 'community-2') {
        return { ...community(), communityId: 'community-2', PK: 'COMMUNITY#community-2' };
      }
      return community();
    });

    const result = await service.putMembership(
      request({ body: { communityIds: ['community-2'] } }),
    );

    expect(result.communityIds).toEqual(['community-2']);
    expect(communities.replaceMemberships).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        communityIds: ['community-2'],
        toDelete: ['community-1'],
      }),
    );
  });

  it('rejects membership in an inactive community', async () => {
    communities.getCommunity.mockResolvedValue(community('inactive'));

    await expect(
      service.putMembership(
        request({ body: { communityIds: ['community-1'] } }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(communities.replaceMemberships).not.toHaveBeenCalled();
  });
});
