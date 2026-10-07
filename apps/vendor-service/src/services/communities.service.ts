import { LambdaRequest } from '@api-hub/utils';
import {
  ConditionalWriteConflictError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import {
  CommunitiesRepository,
  getCommunitiesRepository,
} from '../repositories/communities.repository';
import {
  VendorsRepository,
  getVendorsRepository,
} from '../repositories/vendors.repository';
import { CommunitiesMapper } from '../mappers/communities.mapper';
import { VendorsMapper } from '../mappers/vendors.mapper';
import {
  AddVendorCommunityRequest,
  ReplaceVendorCommunitiesRequest,
  VendorCommunityAssignment,
} from '../types/api-types';
import {
  MAX_VENDOR_COMMUNITIES,
  isCommunityId,
  normalizeCommunityId,
  uniqueCommunityIds,
} from '../domain/community';
import {
  assertAdminAccess,
  assertVendorAccess,
  getPathParam,
  getVendorId,
} from '../utils/helpers';

const baseLogger = createLogger({
  service: 'communities-service',
  redactPII: true,
});

export class CommunitiesService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'CommunitiesService',
  });

  constructor(
    private readonly communitiesRepository: CommunitiesRepository = getCommunitiesRepository(),
    private readonly vendorsRepository: VendorsRepository = getVendorsRepository(),
  ) {}

  async listvendorcommunities(
    request: LambdaRequest,
  ): Promise<{ data: VendorCommunityAssignment[] }> {
    const vendorId = getVendorId(request);
    const vendor = await this.requireVendor(vendorId);
    assertVendorAccess(request, vendor);
    const items = await this.communitiesRepository.listByVendor(vendorId);
    return { data: items.map((item) => CommunitiesMapper.toDomain(item)) };
  }

  async replacevendorcommunities(
    request: LambdaRequest,
  ): Promise<{ data: VendorCommunityAssignment[] }> {
    const userId = assertAdminAccess(request);
    const vendorId = getVendorId(request);
    const body = request.body as ReplaceVendorCommunitiesRequest;
    const communityIds = this.parseCommunityIds(body.communityIds ?? []);
    return this.writeAssignments(vendorId, userId, communityIds, 'replace');
  }

  async addvendorcommunity(
    request: LambdaRequest,
  ): Promise<{ data: VendorCommunityAssignment[] }> {
    const userId = assertAdminAccess(request);
    const vendorId = getVendorId(request);
    const body = request.body as AddVendorCommunityRequest;
    const communityId = this.parseCommunityId(body.communityId);
    const existing = await this.communitiesRepository.listByVendor(vendorId);
    if (existing.some((item) => item.communityId === communityId)) {
      return { data: existing.map((item) => CommunitiesMapper.toDomain(item)) };
    }
    const communityIds = uniqueCommunityIds([
      ...existing.map((item) => item.communityId),
      communityId,
    ]);
    return this.writeAssignments(vendorId, userId, communityIds, 'add');
  }

  async removevendorcommunity(
    request: LambdaRequest,
  ): Promise<{ data: VendorCommunityAssignment[] }> {
    const userId = assertAdminAccess(request);
    const vendorId = getVendorId(request);
    const communityId = this.parseCommunityId(getPathParam(request, 'communityId'));
    const existing = await this.communitiesRepository.listByVendor(vendorId);
    if (!existing.some((item) => item.communityId === communityId)) {
      const vendor = await this.vendorsRepository.getVendorById(vendorId);
      if (!vendor) {
        throw new NotFoundError('Vendor not found');
      }
      return { data: existing.map((item) => CommunitiesMapper.toDomain(item)) };
    }
    const communityIds = existing
      .map((item) => item.communityId)
      .filter((id) => id !== communityId);
    return this.writeAssignments(vendorId, userId, communityIds, 'remove');
  }

  private async writeAssignments(
    vendorId: string,
    userId: string,
    communityIds: string[],
    action: 'replace' | 'add' | 'remove',
  ): Promise<{ data: VendorCommunityAssignment[] }> {
    if (communityIds.length > MAX_VENDOR_COMMUNITIES) {
      throw new ValidationError(
        `A vendor can belong to at most ${MAX_VENDOR_COMMUNITIES} communities`,
      );
    }

    const vendor = await this.requireVendor(vendorId);
    const existing = await this.communitiesRepository.listByVendor(vendorId);
    const next = new Set(communityIds);
    const current = new Set(existing.map((item) => item.communityId));
    const same =
      next.size === current.size &&
      [...next].every((id) => current.has(id));

    if (same) {
      return { data: existing.map((item) => CommunitiesMapper.toDomain(item)) };
    }

    const assignedAt = new Date().toISOString();
    const profile = VendorsMapper.applyCommunityIds(vendor, communityIds, assignedAt);
    const toDelete = existing.filter((item) => !next.has(item.communityId));
    const toAdd = communityIds.filter((id) => !current.has(id));
    const puts = toAdd.map((communityId) => ({
      item: CommunitiesMapper.toItem({
        vendor: profile,
        communityId,
        assignedBy: userId,
        assignedAt,
      }),
      condition: 'not_exists' as const,
    }));

    try {
      await this.vendorsRepository.transactVendorProfile({
        profile,
        expectedUpdatedAt: vendor.updatedAt,
        deletes: toDelete.map((item) => ({ PK: item.PK, SK: item.SK })),
        puts,
      });
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Vendor community assignment conflict');
      }
      throw err;
    }

    this.logger.info({
      event: 'VendorCommunityAssignmentUpdated',
      vendorId,
      userId,
      action,
      communityCount: communityIds.length,
    });

    const saved = await this.communitiesRepository.listByVendor(vendorId);
    return { data: saved.map((item) => CommunitiesMapper.toDomain(item)) };
  }

  private async requireVendor(vendorId: string) {
    const vendor = await this.vendorsRepository.getVendorById(vendorId);
    if (!vendor) {
      throw new NotFoundError('Vendor not found');
    }
    return vendor;
  }

  private parseCommunityIds(values: string[]): string[] {
    return uniqueCommunityIds(values.map((value) => this.parseCommunityId(value)));
  }

  private parseCommunityId(value: string | undefined): string {
    const id = normalizeCommunityId(value ?? '');
    if (!isCommunityId(id)) {
      throw new ValidationError('Invalid communityId');
    }
    return id;
  }
}

let service: CommunitiesService;

export function getCommunitiesService() {
  if (!service) {
    service = new CommunitiesService();
  }
  return service;
}
