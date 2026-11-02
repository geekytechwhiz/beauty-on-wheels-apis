import { createChildLogger, createLogger } from '@api-hub/observability';
import {
  ConditionalWriteConflictError,
  ConflictError,
  ForbiddenError,
  LambdaRequest,
  NotFoundError,
  ValidationError
} from '@api-hub/utils';

import { randomUUID } from 'crypto';

import {
  COVERAGE_APPROVAL_LABELS,
  MAX_VENDOR_COMMUNITIES,
  isCommunityId,
  normalizeCommunityId,
  resolveCoverageApprovalStatus,
  uniqueCommunityIds,
} from '../domain/community';
import { VENDOR_CAPABILITY, VISIT_PERMISSION } from '../domain/vendor-self';
import { CommunitiesMapper } from '../mappers/communities.mapper';
import { VendorsMapper } from '../mappers/vendors.mapper';
import {
  CommunitiesRepository,
  CommunityDirectoryItem,
  CommunityDirectoryPageResult,
  ListCommunitiesParams,
  getCommunitiesRepository
} from '../repositories/communities.repository';
import {
  StaffRepository,
  getStaffRepository,
} from '../repositories/staff.repository';
import {
  VendorsRepository,
  getVendorsRepository,
} from '../repositories/vendors.repository';
import {
  AddVendorCommunityRequest,
  CommunityCoverageApprovalRequest,
  CommunityCoverageApprovalStatus,
  ReplaceVendorCommunitiesRequest,
  VendorCommunityAssignment,
} from '../types/api-types';
import {
  VendorCommunityDdbItem,
  VendorCoverageHistoryDdbItem,
  VendorDdbItem,
} from '../types/repository.types';
import {
  VENDOR_COVERAGE_HISTORY_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';
import {
  assertActiveVendorRoute,
  assertAdminAccess,
  assertVendorAccess,
  assertVendorAction,
  decodeCursor,
  encodeCursor,
  getAuthenticatedUserId,
  getPathParam,
  getVendorId,
  isAdminCaller,
  isVendorOwner,
  parseLimit,
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
    private readonly staffRepository: StaffRepository = getStaffRepository(),
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
  async listcommunities(
    request: LambdaRequest,
  ): Promise<{ data: CommunityDirectoryPageResult }> {
    const params = {
      cityId: request.query?.cityId as string,
      localityId: request.query?.localityId as string,
      postalCode: request.query?.postalCode as string,
      search: request.query?.search as string,
      limit: request.query?.limit as number,
      lastEvaluatedKey: request.query?.lastEvaluatedKey as Record<string, unknown>,
    } as ListCommunitiesParams;

    const items = await this.communitiesRepository.listCommunities(params);
    return { data: items };
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
    const userId = request.context.userContext?.userId as string;
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

  /**
   * Partner directory. Active records only, and only the fields the partner app labels.
   * `ids` resolves known communities for coverage chips and staff routes.
   * A browse without `ids` requires communities:view. Staff with visits:view may resolve ids only.
   */
  async listPartnerCommunityDirectory(request: LambdaRequest): Promise<{
    data: {
      items: PartnerDirectoryCommunity[];
      pagination: { nextCursor: string | null; hasMore: boolean };
    };
  }> {
    const vendorId = getVendorId(request);
    const vendor = await this.requireVendor(vendorId);
    const ids = this.parseIdQuery(request);
    await this.requireDirectoryAccess(request, vendor, ids ? 'lookup' : 'browse');
    if (ids) {
      const items: PartnerDirectoryCommunity[] = [];
      for (const communityId of ids) {
        const record = await this.communitiesRepository.getDirectoryCommunity(communityId);
        if (record?.directoryStatus === 'ACTIVE') items.push(toPartnerDirectoryCommunity(record));
      }
      return { data: { items, pagination: { nextCursor: null, hasMore: false } } };
    }

    const params: ListCommunitiesParams = {
      cityId: queryText(request, 'cityId'),
      localityId: queryText(request, 'localityId'),
      postalCode: queryText(request, 'postalCode'),
      search: queryText(request, 'search'),
      limit: parseLimit(queryText(request, 'limit')),
      lastEvaluatedKey: decodeCursor(queryText(request, 'cursor')),
    };
    let page: CommunityDirectoryPageResult;
    try {
      page = await this.communitiesRepository.listCommunities(params);
    } catch (error) {
      if (
        error instanceof Error
        && /Invalid|must be|must contain/.test(error.message)
      ) {
        throw new ValidationError(error.message);
      }
      throw error;
    }
    return {
      data: {
        items: page.items
          .filter((item) => item.directoryStatus === 'ACTIVE')
          .map(toPartnerDirectoryCommunity),
        pagination: {
          nextCursor: encodeCursor(page.lastEvaluatedKey),
          hasMore: Boolean(page.lastEvaluatedKey),
        },
      },
    };
  }

  /** Owner or communities:view. Assignment ids plus directory labels. Does not return assignedBy. */
  async getPartnerCommunityCoverage(request: LambdaRequest): Promise<{ data: PartnerCommunityCoverage }> {
    const vendorId = getVendorId(request);
    const vendor = await this.requireVendor(vendorId);
    await this.requireDirectoryAccess(request, vendor, 'browse');
    return { data: await this.presentCoverage(vendor) };
  }

  /**
   * Owner or communities:manage. Replaces this vendor's coverage only.
   * Selected ids must already exist and be active. expectedUpdatedAt is the profile
   * timestamp from the coverage read; a mismatch is a conflict and writes nothing.
   */
  async replacePartnerCommunityCoverage(request: LambdaRequest): Promise<{ data: PartnerCommunityCoverage }> {
    const vendorId = getVendorId(request);
    const vendor = await this.requireVendor(vendorId);
    const userId = await this.requireDirectoryAccess(request, vendor, 'manage');
    const body = request.body as { communityIds?: string[]; expectedUpdatedAt?: string };
    if (!body.expectedUpdatedAt || body.expectedUpdatedAt !== vendor.updatedAt) {
      throw new ConflictError('Vendor community assignment conflict');
    }
    const communityIds = this.parseCommunityIds(body.communityIds ?? []);
    await this.assertActiveDirectoryCommunities(communityIds);
    await this.writeAssignments(vendorId, userId, communityIds, 'replace', body.expectedUpdatedAt);
    const saved = await this.requireVendor(vendorId);
    return { data: await this.presentCoverage(saved) };
  }

  /**
   * Admin decision on one vendor community. Records actor, time, optional reason and a
   * history row. Setting the status the row already has is a no-op (idempotent).
   */
  async updatecommunitycoverageapproval(
    request: LambdaRequest,
  ): Promise<{ data: CommunityCoverageApprovalResult }> {
    const userId = assertAdminAccess(request);
    const vendorId = getVendorId(request);
    const communityId = this.parseCommunityId(getPathParam(request, 'communityId'));
    const body = request.body as CommunityCoverageApprovalRequest;

    const coverage = await this.communitiesRepository.getCoverage(vendorId, communityId);
    if (!coverage) {
      throw new NotFoundError('Community coverage not found');
    }

    const fromStatus = resolveCoverageApprovalStatus(coverage);
    if (fromStatus === body.status) {
      return { data: toApprovalResult(coverage, undefined) };
    }

    const at = new Date().toISOString();
    const reason = body.reason?.trim() || undefined;
    const historyId = randomUUID();
    const history: VendorCoverageHistoryDdbItem = {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.coverageHistorySk(communityId, at, historyId),
      vendorId,
      communityId,
      historyId,
      fromStatus,
      toStatus: body.status,
      actorUserId: userId,
      ...(reason ? { reason } : {}),
      at,
      entityType: VENDOR_COVERAGE_HISTORY_ENTITY_TYPE,
    };
    const updated: VendorCommunityDdbItem = {
      ...coverage,
      approvalStatus: body.status,
      approvalUpdatedAt: at,
      approvalUpdatedBy: userId,
      updatedAt: at,
    };
    if (reason) {
      updated.approvalReason = reason;
    } else {
      delete updated.approvalReason;
    }

    try {
      await this.communitiesRepository.writeCoverageDecision({
        item: updated,
        expectedUpdatedAt: coverage.updatedAt,
        history,
      });
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Community coverage changed. Reload and retry.');
      }
      throw err;
    }

    this.logger.info({
      event: 'VendorCommunityCoverageDecided',
      vendorId,
      communityId,
      userId,
      fromStatus,
      toStatus: body.status,
    });

    return { data: toApprovalResult(updated, history) };
  }

  /** 409 unless the vendor's coverage of this community is APPROVED. */
  async assertApprovedCoverage(
    vendorId: string,
    communityId: string,
  ): Promise<VendorCommunityDdbItem> {
    return this.communitiesRepository.assertApprovedCoverage(vendorId, communityId);
  }

  async removevendorcommunity(
    request: LambdaRequest,
  ): Promise<{ data: VendorCommunityAssignment[] }> {
    const userId = assertAdminAccess(request);
    const vendorId = getVendorId(request);
    const communityId = this.parseCommunityId(
      getPathParam(request, 'communityId'),
    );
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
    lockedUpdatedAt?: string,
  ): Promise<{ data: VendorCommunityAssignment[] }> {
    if (communityIds.length > MAX_VENDOR_COMMUNITIES) {
      throw new ValidationError(
        `A vendor can belong to at most ${MAX_VENDOR_COMMUNITIES} communities`,
      );
    }

    const vendor = await this.requireVendor(vendorId);
    if (lockedUpdatedAt && vendor.updatedAt !== lockedUpdatedAt) {
      throw new ConflictError('Vendor community assignment conflict');
    }
    const existing = await this.communitiesRepository.listByVendor(vendorId);
    const next = new Set(communityIds);
    const current = new Set(existing.map((item) => item.communityId));
    const same =
      next.size === current.size && [...next].every((id) => current.has(id));

    if (same) {
      return { data: existing.map((item) => CommunitiesMapper.toDomain(item)) };
    }

    // Only newly added communities are written, and CommunitiesMapper.toItem always starts
    // them as REQUESTED. Communities that stay in the set are untouched, so APPROVED /
    // REJECTED / SUSPENDED decisions survive a replace. Removed ones are deleted outright.
    const assignedAt = new Date().toISOString();
    const profile = VendorsMapper.applyCommunityIds(
      vendor,
      communityIds,
      assignedAt,
    );
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
        expectedUpdatedAt: lockedUpdatedAt ?? vendor.updatedAt,
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
    return uniqueCommunityIds(
      values.map((value) => this.parseCommunityId(value)),
    );
  }

  private parseCommunityId(value: string | undefined): string {
    const id = normalizeCommunityId(value ?? '');
    if (!isCommunityId(id)) {
      throw new ValidationError('Invalid communityId');
    }
    return id;
  }

  private parseIdQuery(request: LambdaRequest): string[] | undefined {
    const raw = queryText(request, 'ids');
    if (!raw) return undefined;
    const ids = uniqueCommunityIds(raw.split(',').map((value) => value.trim()).filter(Boolean));
    if (ids.length < 1 || ids.length > MAX_VENDOR_COMMUNITIES) {
      throw new ValidationError(`ids must contain 1 to ${MAX_VENDOR_COMMUNITIES} community ids`);
    }
    return this.parseCommunityIds(ids);
  }

  private async assertActiveDirectoryCommunities(communityIds: string[]): Promise<void> {
    const rejected: string[] = [];
    for (const communityId of communityIds) {
      const record = await this.communitiesRepository.getDirectoryCommunity(communityId);
      if (!record || record.directoryStatus !== 'ACTIVE') rejected.push(communityId);
    }
    if (rejected.length) {
      throw new ValidationError(`Unknown or inactive community: ${rejected.join(', ')}`);
    }
  }

  private async presentCoverage(vendor: VendorDdbItem): Promise<PartnerCommunityCoverage> {
    const assignments = await this.communitiesRepository.listByVendor(vendor.vendorId);
    const communityIds = assignments.map((item) => item.communityId);
    const communities: PartnerCoverageCommunity[] = [];
    for (const assignment of assignments) {
      const record = await this.communitiesRepository.getDirectoryCommunity(assignment.communityId);
      if (record) {
        communities.push({
          ...toPartnerDirectoryCommunity(record),
          ...toCoverageApproval(assignment),
        });
      }
    }
    return {
      vendorId: vendor.vendorId,
      updatedAt: vendor.updatedAt,
      communityIds,
      communities,
    };
  }

  private async requireDirectoryAccess(
    request: LambdaRequest,
    vendor: VendorDdbItem,
    mode: 'browse' | 'lookup' | 'manage',
  ): Promise<string> {
    assertActiveVendorRoute(request);
    const userId = getAuthenticatedUserId(request);
    if (isVendorOwner(vendor, userId) || isAdminCaller(request)) return userId;
    const memberships = await this.staffRepository.listMembershipsByUserId(userId);
    const membership = memberships.find((item) => item.vendorId === vendor.vendorId);
    const action = mode === 'manage'
      ? VENDOR_CAPABILITY.COMMUNITY_MANAGE
      : mode === 'lookup'
        ? VISIT_PERMISSION.VIEW
        : VENDOR_CAPABILITY.COMMUNITY_VIEW;
    try {
      return assertVendorAction(request, vendor, action, membership);
    } catch (error) {
      if (mode === 'lookup' && error instanceof ForbiddenError) {
        return assertVendorAction(request, vendor, VENDOR_CAPABILITY.COMMUNITY_VIEW, membership);
      }
      throw error;
    }
  }
}

export interface PartnerDirectoryCommunity {
  communityId: string;
  name: string;
  cityId: string;
  cityName: string;
  localityId: string | null;
  localityName: string | null;
  postalCode: string | null;
  accessType?: string;
}

export interface PartnerCoverageApproval {
  approvalStatus: CommunityCoverageApprovalStatus;
  approvalStatusLabel: string;
  approvalRequestedAt: string | null;
  approvalUpdatedAt: string | null;
  approvalReason: string | null;
}

export interface PartnerCoverageCommunity
  extends PartnerDirectoryCommunity,
    PartnerCoverageApproval {}

export interface PartnerCommunityCoverage {
  vendorId: string;
  updatedAt: string;
  communityIds: string[];
  communities: PartnerCoverageCommunity[];
}

export interface CommunityCoverageApprovalResult extends PartnerCoverageApproval {
  vendorId: string;
  communityId: string;
  approvalUpdatedBy: string | null;
  /** The history row written by this call. Absent when the status was already set. */
  historyEntry?: {
    historyId: string;
    fromStatus: CommunityCoverageApprovalStatus;
    toStatus: CommunityCoverageApprovalStatus;
    actorUserId: string;
    reason: string | null;
    at: string;
  };
}

function toCoverageApproval(item: VendorCommunityDdbItem): PartnerCoverageApproval {
  const approvalStatus = resolveCoverageApprovalStatus(item);
  return {
    approvalStatus,
    approvalStatusLabel: COVERAGE_APPROVAL_LABELS[approvalStatus],
    approvalRequestedAt: item.approvalRequestedAt ?? item.assignedAt ?? null,
    approvalUpdatedAt: item.approvalUpdatedAt ?? null,
    approvalReason: item.approvalReason ?? null,
  };
}

function toApprovalResult(
  item: VendorCommunityDdbItem,
  history: VendorCoverageHistoryDdbItem | undefined,
): CommunityCoverageApprovalResult {
  return {
    vendorId: item.vendorId,
    communityId: item.communityId,
    ...toCoverageApproval(item),
    approvalUpdatedBy: item.approvalUpdatedBy ?? null,
    ...(history
      ? {
          historyEntry: {
            historyId: history.historyId,
            fromStatus: history.fromStatus,
            toStatus: history.toStatus,
            actorUserId: history.actorUserId,
            reason: history.reason ?? null,
            at: history.at,
          },
        }
      : {}),
  };
}

function toPartnerDirectoryCommunity(item: CommunityDirectoryItem): PartnerDirectoryCommunity {
  return {
    communityId: item.communityId,
    name: item.name,
    cityId: item.cityId,
    cityName: item.cityName,
    localityId: item.localityId ?? null,
    localityName: item.localityName ?? null,
    postalCode: item.postalCode ?? null,
    ...(item.accessType ? { accessType: item.accessType } : {}),
  };
}

function queryText(request: LambdaRequest, key: string): string | undefined {
  const params = request.params as Record<string, unknown> | undefined;
  const value = params?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

let service: CommunitiesService;

export function getCommunitiesService() {
  if (!service) {
    service = new CommunitiesService();
  }
  return service;
}
