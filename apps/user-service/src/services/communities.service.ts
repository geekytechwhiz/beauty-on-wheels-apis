import {
  ConditionalWriteConflictError,
  ConflictError,
  EntityIdGenerator,
  LambdaRequest,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { COMMUNITY_STATUS, ENTITY_TYPE, MAX_COMMUNITY_MEMBERSHIPS } from '../domain/constants';
import {
  toCommunity,
  toCommunityDirectoryItem,
  toMembershipRecord,
} from '../mappers/communities.mapper';
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
  getAuthenticatedUserId,
  getPathParam,
  getQueryParam,
  getUserId,
  hasCallerIdentity,
  isAdminCaller,
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
    const communityId = EntityIdGenerator.CommunityId();
    const record = this.toRecord({
      communityId,
      name: body.name,
      code: body.code ?? toCommunityCode(body.name),
      accessType: body.accessType,
      city: body.city,
      cityId: body.cityId ?? (body.city ? toLocationId(body.city) : undefined),
      locality: body.locality,
      localityId: body.localityId ?? (body.locality ? toLocationId(body.locality) : undefined),
      postalCode: body.postalCode,
      streetAddress: body.streetAddress,
      contactPersonName: body.contactPersonName,
      contactPersonTitle: body.contactPersonTitle,
      contactPhone: body.contactPhone,
      contactEmail: body.contactEmail,
      totalResidentialUnits: body.totalResidentialUnits,
      estimatedVehicleCount: body.estimatedVehicleCount,
      leadSource: body.leadSource,
      intakeNotes: body.intakeNotes,
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
    const started = Date.now();
    // if (!hasCallerIdentity(request)) {
    //   getAuthenticatedUserId(request);
    // }
    const statusQuery = getQueryParam(request, 'status');
    // if (statusQuery && !isAdminCaller(request) && statusQuery !== COMMUNITY_STATUS.ACTIVE) {
    //   throw new ValidationError('Only an administrator can filter community status');
    // }
    const status =
      isAdminCaller(request) && statusQuery === 'all'
        ? undefined
        : isAdminCaller(request) && statusQuery === COMMUNITY_STATUS.INACTIVE
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
      search: getQueryParam(request, 'search')?.toLowerCase(),
      cityId: getQueryParam(request, 'cityId'),
      localityId: getQueryParam(request, 'localityId'),
      postalCode: getQueryParam(request, 'postalCode'),
      limit: parseLimit(request.params?.limit),
      lastEvaluatedKey: decodeCursor(request.params?.cursor),
    });
    const nextCursor = encodeCursor(page.lastEvaluatedKey);

    const items = page.items.map((item) =>
      isAdminCaller(request) ? toCommunity(item) : toCommunityDirectoryItem(item),
    );
    this.logger.info({
      event: 'list_communities_success',
      correlationId: (request.context as { correlationId?: string } | undefined)?.correlationId,
      service: 'user-service',
      operation: 'GET /communities',
      outcome: 'success',
      durationMs: Date.now() - started,
      count: items.length,
      hasMore: Boolean(page.lastEvaluatedKey),
      status: status ?? 'all',
    });
    return {
      items,
      pagination: {
        nextCursor,
        hasMore: Boolean(page.lastEvaluatedKey),
        total: null,
        totalAvailability: 'unavailable',
        totalReason:
          'items.length is this page only. Exhaust nextCursor before counting active communities. Do not copy community rows into Vendor, Booking, or Catalog.',
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
      code: body.code ?? existing.code ?? toCommunityCode(body.name ?? existing.name),
      accessType: body.accessType ?? existing.accessType,
      city: body.city ?? existing.city,
      cityId: body.cityId ?? existing.cityId ?? (body.city ? toLocationId(body.city) : undefined),
      locality: body.locality ?? existing.locality,
      localityId:
        body.localityId
        ?? existing.localityId
        ?? (body.locality ? toLocationId(body.locality) : undefined),
      postalCode: body.postalCode ?? existing.postalCode,
      streetAddress: body.streetAddress ?? existing.streetAddress,
      contactPersonName: body.contactPersonName ?? existing.contactPersonName,
      contactPersonTitle: body.contactPersonTitle ?? existing.contactPersonTitle,
      contactPhone: body.contactPhone ?? existing.contactPhone,
      contactEmail: body.contactEmail ?? existing.contactEmail,
      totalResidentialUnits: body.totalResidentialUnits ?? existing.totalResidentialUnits,
      estimatedVehicleCount: body.estimatedVehicleCount ?? existing.estimatedVehicleCount,
      leadSource: body.leadSource ?? existing.leadSource,
      intakeNotes: body.intakeNotes ?? existing.intakeNotes,
      status: body.status ?? existing.status,
      createdAt: existing.createdAt,
      updatedAt: now,
    });

    try {
      await this.communities.saveCommunity(record, existing.code);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Community code is already in use or the community changed');
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
    await this.communities.saveCommunity(record, existing.code);

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
    const userId = getUserId(request);
    assertOwnerAdminOrService(request, userId);
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
    cityId?: string;
    locality?: string;
    localityId?: string;
    postalCode?: string;
    accessType?: CommunityRecord['accessType'];
    streetAddress?: string;
    contactPersonName?: string;
    contactPersonTitle?: string;
    contactPhone?: string;
    contactEmail?: string;
    totalResidentialUnits?: number;
    estimatedVehicleCount?: number;
    leadSource?: CommunityRecord['leadSource'];
    intakeNotes?: string;
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
      ...(input.cityId ? { cityId: input.cityId } : {}),
      ...(input.locality ? { locality: input.locality } : {}),
      ...(input.localityId ? { localityId: input.localityId } : {}),
      ...(input.postalCode ? { postalCode: input.postalCode } : {}),
      ...(input.accessType ? { accessType: input.accessType } : {}),
      ...(input.streetAddress ? { streetAddress: input.streetAddress } : {}),
      ...(input.contactPersonName ? { contactPersonName: input.contactPersonName } : {}),
      ...(input.contactPersonTitle ? { contactPersonTitle: input.contactPersonTitle } : {}),
      ...(input.contactPhone ? { contactPhone: input.contactPhone } : {}),
      ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
      ...(input.totalResidentialUnits !== undefined
        ? { totalResidentialUnits: input.totalResidentialUnits }
        : {}),
      ...(input.estimatedVehicleCount !== undefined
        ? { estimatedVehicleCount: input.estimatedVehicleCount }
        : {}),
      ...(input.leadSource ? { leadSource: input.leadSource } : {}),
      ...(input.intakeNotes ? { intakeNotes: input.intakeNotes } : {}),
      searchText: [
        input.name,
        input.code,
        input.city,
        input.cityId,
        input.locality,
        input.localityId,
        input.postalCode,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .toLowerCase(),
    };
  }
}

function toCommunityCode(name: string): string {
  const code = name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  if (!code) throw new ValidationError('Community name must contain letters or digits');
  return code;
}

function toLocationId(name: string): string {
  const normalized = name
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  if (!normalized) throw new ValidationError('Location must contain letters or digits');
  return normalized;
}

let service: CommunitiesService;

export function getCommunitiesService(): CommunitiesService {
  if (!service) {
    service = new CommunitiesService();
  }
  return service;
}
