import { randomUUID } from 'crypto';
import {
  ConditionalWriteConflictError,
  ConflictError,
  LambdaRequest,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { COMMUNITY_STATUS, ENTITY_TYPE, MAX_COMMUNITY_MEMBERSHIPS } from '../domain/constants';
import { toCommunity, toMembershipRecord } from '../mappers/communities.mapper';
import {
  CommunitiesRepository,
  getCommunitiesRepository,
} from '../repositories/communities.repository';
import {
  CustomersRepository,
  getCustomersRepository,
} from '../repositories/customers.repository';
import {
  Community,
  CommunityCreate,
  CommunityListResponse,
  CommunityUpdate,
  CustomerCommunities,
  CustomerCommunitiesUpdate,
} from '../types/api-types';
import { CommunityRecord } from '../types/records';
import {
  assertAdminAccess,
  assertOwnerAdminOrService,
  decodeCursor,
  encodeCursor,
  getPathParam,
  getQueryParam,
  getUserId,
  parseLimit,
  UserKeyBuilder,
} from '../utils';

const baseLogger = createLogger({
  service: 'communities-service',
  redactPII: true,
});

export class CommunitiesService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'CommunitiesService',
  });

  constructor(
    private readonly communities: CommunitiesRepository = getCommunitiesRepository(),
    private readonly customers: CustomersRepository = getCustomersRepository(),
  ) {}

  async createCommunity(request: LambdaRequest): Promise<Community> {
    assertAdminAccess(request);
    const body = request.body as CommunityCreate;
    const now = new Date().toISOString();
    const communityId = randomUUID();
    const record = this.toRecord({
      communityId,
      name: body.name,
      code: body.code,
      city: body.city,
      status: COMMUNITY_STATUS.ACTIVE,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await this.communities.createCommunity(record);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Community already exists');
      }
      throw error;
    }

    this.logger.info({
      event: 'create_community_success',
      communityId,
    });

    return toCommunity(record);
  }

  async listCommunities(request: LambdaRequest): Promise<CommunityListResponse> {
    assertAdminAccess(request);
    const statusQuery = getQueryParam(request, 'status');
    const status =
      statusQuery === 'all'
        ? undefined
        : statusQuery === COMMUNITY_STATUS.INACTIVE
          ? COMMUNITY_STATUS.INACTIVE
          : COMMUNITY_STATUS.ACTIVE;

    if (
      statusQuery &&
      statusQuery !== 'all' &&
      statusQuery !== COMMUNITY_STATUS.ACTIVE &&
      statusQuery !== COMMUNITY_STATUS.INACTIVE
    ) {
      throw new ValidationError('status must be active, inactive, or all');
    }

    const page = await this.communities.listCommunities({
      status,
      limit: parseLimit(request.params?.limit),
      lastEvaluatedKey: decodeCursor(request.params?.cursor),
    });
    const nextCursor = encodeCursor(page.lastEvaluatedKey);

    return {
      items: page.items.map((item) => toCommunity(item)),
      pagination: {
        nextCursor,
        hasMore: Boolean(page.lastEvaluatedKey),
      },
    };
  }

  async getCommunity(request: LambdaRequest): Promise<Community> {
    assertAdminAccess(request);
    const community = await this.requireCommunity(getPathParam(request, 'communityId'));
    return toCommunity(community);
  }

  async updateCommunity(request: LambdaRequest): Promise<Community> {
    assertAdminAccess(request);
    const communityId = getPathParam(request, 'communityId');
    const existing = await this.requireCommunity(communityId);
    const body = request.body as CommunityUpdate;
    const now = new Date().toISOString();
    const record = this.toRecord({
      communityId,
      name: body.name ?? existing.name,
      code: body.code ?? existing.code,
      city: body.city ?? existing.city,
      status: body.status ?? existing.status,
      createdAt: existing.createdAt,
      updatedAt: now,
    });

    try {
      await this.communities.saveCommunity(record);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new NotFoundError('Community not found');
      }
      throw error;
    }

    this.logger.info({
      event: 'update_community_success',
      communityId,
    });

    return toCommunity(record);
  }

  async deleteCommunity(request: LambdaRequest): Promise<Community> {
    assertAdminAccess(request);
    const communityId = getPathParam(request, 'communityId');
    const existing = await this.requireCommunity(communityId);
    if (existing.status === COMMUNITY_STATUS.INACTIVE) {
      return toCommunity(existing);
    }

    const now = new Date().toISOString();
    const record = this.toRecord({
      ...existing,
      status: COMMUNITY_STATUS.INACTIVE,
      updatedAt: now,
    });
    await this.communities.saveCommunity(record);

    this.logger.info({
      event: 'delete_community_success',
      communityId,
    });

    return toCommunity(record);
  }

  async getMembership(request: LambdaRequest): Promise<CustomerCommunities> {
    const userId = getUserId(request);
    assertOwnerAdminOrService(request, userId);
    const profile = await this.customers.getProfile(userId);
    if (!profile) {
      throw new NotFoundError('Customer profile not found');
    }

    return {
      userId,
      communityIds: profile.communityIds ?? [],
    };
  }

  async putMembership(request: LambdaRequest): Promise<CustomerCommunities> {
    assertAdminAccess(request);
    const userId = getUserId(request);
    const profile = await this.customers.getProfile(userId);
    if (!profile) {
      throw new NotFoundError('Customer profile not found');
    }

    const body = request.body as CustomerCommunitiesUpdate;
    const communityIds = [...new Set(body.communityIds)];
    if (communityIds.length > MAX_COMMUNITY_MEMBERSHIPS) {
      throw new ValidationError(
        `A customer can belong to at most ${MAX_COMMUNITY_MEMBERSHIPS} communities`,
      );
    }

    for (const communityId of communityIds) {
      const community = await this.communities.getCommunity(communityId);
      if (!community) {
        throw new NotFoundError('Community not found');
      }
      if (community.status !== COMMUNITY_STATUS.ACTIVE) {
        throw new ValidationError('Community is not active');
      }
    }

    const existing = await this.communities.listMemberships(userId);
    const existingIds = new Set(existing.map((item) => item.communityId));
    const desired = new Set(communityIds);
    const now = new Date().toISOString();

    await this.communities.replaceMemberships({
      userId,
      communityIds,
      updatedAt: now,
      toPut: communityIds
        .filter((communityId) => !existingIds.has(communityId))
        .map((communityId) =>
          toMembershipRecord({ userId, communityId, createdAt: now }),
        ),
      toDelete: [...existingIds].filter((communityId) => !desired.has(communityId)),
    });

    this.logger.info({
      event: 'put_membership_success',
      userId,
      communityCount: communityIds.length,
    });

    return { userId, communityIds };
  }

  private async requireCommunity(communityId: string): Promise<CommunityRecord> {
    const community = await this.communities.getCommunity(communityId);
    if (!community) {
      throw new NotFoundError('Community not found');
    }
    return community;
  }

  private toRecord(input: {
    communityId: string;
    name: string;
    code?: string;
    city?: string;
    status: CommunityRecord['status'];
    createdAt: string;
    updatedAt: string;
  }): CommunityRecord {
    return {
      PK: UserKeyBuilder.communityPk(input.communityId),
      SK: UserKeyBuilder.communitySk(),
      entityType: ENTITY_TYPE.COMMUNITY,
      communityId: input.communityId,
      name: input.name,
      status: input.status,
      GSI1PK: UserKeyBuilder.communityListPk(),
      GSI1SK: UserKeyBuilder.communityListSk(input.createdAt, input.communityId),
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      ...(input.code ? { code: input.code } : {}),
      ...(input.city ? { city: input.city } : {}),
    };
  }
}

let service: CommunitiesService;

export function getCommunitiesService(): CommunitiesService {
  if (!service) {
    service = new CommunitiesService();
  }
  return service;
}
