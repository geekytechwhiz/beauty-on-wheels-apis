import { randomUUID } from 'crypto';
import { LambdaRequest } from '@api-hub/utils';
import {
  ConflictError,
  ConditionalWriteConflictError,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import { createLogger, createChildLogger, getLoggerContext } from '@api-hub/observability';

import {
  VendorsRepository,
  getVendorsRepository,
  VendorPageResult,
} from '../repositories/vendors.repository';
import {
  CommunitiesRepository,
  getCommunitiesRepository,
} from '../repositories/communities.repository';
import { VendorsMapper } from '../mappers/vendors.mapper';
import { CommunitiesMapper } from '../mappers/communities.mapper';
import { OwnerMapper } from '../mappers/owner.mapper';
import {
  ApproveVendorRequest,
  CreateVendorRequest,
  OperationalStatus,
  RejectVendorRequest,
  UpdateOperationalStatusRequest,
  UpdateVendorRequest,
  UpdateVendorStatusRequest,
  Vendor,
  VendorListResponse,
  VendorStatus,
  VendorStatusHistoryEntry,
} from '../types/api-types';
import {
  assertAdminAccess,
  assertVendorAccess,
  getAuthenticatedUserId,
  getVendorId,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from '../utils/helpers';
import { RegisterVendorRequest } from '../schemas/vendors.schema';
import {
  assertOperationalStatusAllowed,
  decideVendorStatusTransition,
  isVendorApproval,
  isVendorRejection,
} from '../domain/lifecycle';
import { isCommunityId, normalizeCommunityId } from '../domain/community';

const baseLogger = createLogger({
  service: 'vendors-service',
  redactPII: true,
});

const VALID_VENDOR_STATUSES: VendorStatus[] = [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'INACTIVE',
  'REJECTED',
];

const VALID_OPERATIONAL_STATUSES: OperationalStatus[] = [
  'ONLINE',
  'OFFLINE',
  'BUSY',
  'TEMPORARILY_UNAVAILABLE',
];

export class VendorsService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'VendorsService',
  });

  constructor(
    private readonly repository: VendorsRepository = getVendorsRepository(),
    private readonly communitiesRepository: CommunitiesRepository = getCommunitiesRepository(),
  ) {}

  private async requireVendor(vendorId: string) {
    const item = await this.repository.getVendorById(vendorId);
    if (!item) {
      throw new NotFoundError('Vendor not found');
    }
    return item;
  }

  private toListResponse(result: VendorPageResult): VendorListResponse {
    const nextCursor = encodeCursor(result.lastEvaluatedKey);

    return {
      data: result.items.map((item) => VendorsMapper.toDomain(item)),
      pagination: {
        nextCursor,
        hasMore: Boolean(result.lastEvaluatedKey),
      },
    };
  }

  async registerVendor(request: LambdaRequest): Promise<Vendor> {
    const userId = getAuthenticatedUserId(request);
    const body = (request.body ?? {}) as RegisterVendorRequest;

    this.logger.info({
      event: 'createvendor_start',
      userId,
    });

    const vendorId = randomUUID();
    const profile = VendorsMapper.toInitialDdbItem({
      vendorId,
      ownerUserId: userId,
      email: body.email,
      phoneNumber: body.phoneNumber,
    });
    const owner = OwnerMapper.initialOwner(vendorId, userId);

    try {
      await this.repository.createVendor(profile, owner);
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Vendor already exists');
      }
      throw err;
    }

    this.logger.info({
      event: 'createvendor_success',
      userId,
      vendorId,
    });

    return VendorsMapper.toDomain(profile);
  }

  async createvendor(request: LambdaRequest): Promise<Vendor> {
    const userId = getAuthenticatedUserId(request);
    const body = (request.body ?? {}) as CreateVendorRequest;

    this.logger.info({
      event: 'createvendor_start',
      userId,
    });

    const vendorId = randomUUID();
    const profile = VendorsMapper.toInitialDdbItem({
      vendorId,
      ownerUserId: userId,
      vendorType: body.vendorType,
      businessName: body.businessName,
      contactName: body.contactName,
      phoneNumber: body.phoneNumber,
      email: body.email,
      description: body.description,
      gstNumber: body.gstNumber,
      panNumber: body.panNumber,
      profileImageUrl: body.profileImageUrl,
    });
    const owner = OwnerMapper.initialOwner(vendorId, userId);

    try {
      await this.repository.createVendor(profile, owner);
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Vendor already exists');
      }
      throw err;
    }

    this.logger.info({
      event: 'createvendor_success',
      userId,
      vendorId,
    });

    return VendorsMapper.toDomain(profile);
  }

  async listvendors(request: LambdaRequest): Promise<VendorListResponse> {
    const userId = assertAdminAccess(request);

    const status = request.params?.status as string | undefined;
    const operationalStatus = request.params?.operationalStatus as
      | string
      | undefined;
    const city = request.params?.city as string | undefined;
    const postalCode = request.params?.postalCode as string | undefined;
    const communityId = request.params?.communityId as string | undefined;
    const limit = parseLimit(request.params?.limit);
    const lastEvaluatedKey = decodeCursor(request.params?.cursor);

    this.logger.info({
      event: 'listvendors_start',
      userId,
      status,
      operationalStatus,
      city,
      postalCode,
      communityId,
      limit,
    });

    if (status && !VALID_VENDOR_STATUSES.includes(status as VendorStatus)) {
      throw new ValidationError(
        `Invalid status. Supported values: ${VALID_VENDOR_STATUSES.join(', ')}`,
      );
    }

    if (
      operationalStatus &&
      !VALID_OPERATIONAL_STATUSES.includes(
        operationalStatus as OperationalStatus,
      )
    ) {
      throw new ValidationError(
        `Invalid operationalStatus. Supported values: ${VALID_OPERATIONAL_STATUSES.join(', ')}`,
      );
    }

    if (communityId && (city || postalCode)) {
      throw new ValidationError(
        'communityId cannot be combined with city or postalCode filters',
      );
    }

    if (communityId && !isCommunityId(normalizeCommunityId(communityId))) {
      throw new ValidationError('Invalid communityId');
    }

    let result: VendorPageResult;

    if (communityId) {
      result = await this.listVendorsInCommunity({
        communityId: normalizeCommunityId(communityId),
        status: status as VendorStatus | undefined,
        operationalStatus: operationalStatus as OperationalStatus | undefined,
        limit,
        lastEvaluatedKey,
      });
    } else if (city) {
      result = await this.repository.listVendorsByCity({
        city,
        postalCode,
        limit,
        lastEvaluatedKey,
      });
    } else if (postalCode) {
      result = await this.repository.listVendorsByPostalCode({
        postalCode,
        limit,
        lastEvaluatedKey,
      });
    } else {
      result = await this.repository.listVendors({
        status: status as VendorStatus | undefined,
        operationalStatus: operationalStatus as OperationalStatus | undefined,
        limit,
        lastEvaluatedKey,
      });
    }

    const response = this.toListResponse(result);

    this.logger.info({
      event: 'listvendors_success',
      userId,
      count: response.data.length,
      hasMore: response.pagination?.hasMore,
    });

    return response;
  }

  async getvendor(request: LambdaRequest): Promise<Vendor> {
    const vendorId = getVendorId(request);
    const item = await this.requireVendor(vendorId);
    assertVendorAccess(request, item);

    this.logger.info({
      event: 'getvendor_start',
      vendorId,
    });

    const address = await this.repository.getAddress(vendorId);
    const vendor = VendorsMapper.toDomain(item, address);

    this.logger.info({
      event: 'getvendor_success',
      vendorId,
    });

    return vendor;
  }

  async updatevendor(request: LambdaRequest): Promise<Vendor> {
    const vendorId = getVendorId(request);
    const existing = await this.requireVendor(vendorId);
    assertVendorAccess(request, existing);
    const body = request.body as UpdateVendorRequest;

    this.logger.info({
      event: 'updatevendor_start',
      vendorId,
    });

    const updated = VendorsMapper.applyUpdate(existing, body);

    try {
      await this.repository.updateVendor(updated);
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Vendor update conflict');
      }
      throw err;
    }

    const address = await this.repository.getAddress(vendorId);

    this.logger.info({
      event: 'updatevendor_success',
      vendorId,
    });

    return VendorsMapper.toDomain(updated, address);
  }

  async updatevendorstatus(request: LambdaRequest): Promise<Vendor> {
    const userId = assertAdminAccess(request);
    const vendorId = getVendorId(request);
    const body = request.body as UpdateVendorStatusRequest;
    return this.transitionStatus(vendorId, userId, body.status, body.reason);
  }

  async approvevendor(request: LambdaRequest): Promise<Vendor> {
    const userId = assertAdminAccess(request);
    const vendorId = getVendorId(request);
    const body = (request.body ?? {}) as ApproveVendorRequest;
    return this.transitionStatus(vendorId, userId, 'ACTIVE', body.reason);
  }

  async rejectvendor(request: LambdaRequest): Promise<Vendor> {
    const userId = assertAdminAccess(request);
    const vendorId = getVendorId(request);
    const body = request.body as RejectVendorRequest;
    return this.transitionStatus(vendorId, userId, 'REJECTED', body.reason);
  }

  async getvendorstatushistory(
    request: LambdaRequest,
  ): Promise<{ data: VendorStatusHistoryEntry[] }> {
    const vendorId = getVendorId(request);
    const existing = await this.requireVendor(vendorId);
    assertVendorAccess(request, existing);
    const items = await this.repository.listStatusHistory(vendorId);
    return {
      data: items.map((item) => ({
        vendorId: item.vendorId,
        previousStatus: item.previousStatus,
        newStatus: item.newStatus,
        reviewerUserId: item.reviewerUserId,
        reason: item.reason,
        reviewedAt: item.reviewedAt,
        correlationId: item.correlationId,
      })),
    };
  }

  private async transitionStatus(
    vendorId: string,
    userId: string,
    status: VendorStatus,
    reason?: string,
  ): Promise<Vendor> {
    this.logger.info({
      event: 'updatevendorstatus_start',
      userId,
      vendorId,
      status,
    });

    const existing = await this.requireVendor(vendorId);
    const decision = decideVendorStatusTransition({
      from: existing.status,
      to: status,
      onboardingStatus: existing.onboardingStatus,
      reason,
    });

    if (decision.kind === 'invalid') {
      throw new ConflictError(decision.message);
    }

    if (decision.kind === 'idempotent') {
      this.logger.info({
        event: 'updatevendorstatus_idempotent',
        userId,
        vendorId,
        status,
      });
      return VendorsMapper.toDomain(existing);
    }

    const reviewedAt = new Date().toISOString();
    const correlationId = correlationFromContext();
    const updated = VendorsMapper.applyLifecycleTransition(existing, {
      status,
      reviewerUserId: userId,
      reason,
      reviewedAt,
      correlationId,
    });
    const history = VendorsMapper.toStatusHistoryItem(updated, randomUUID());
    const communities = await this.communitiesRepository.listByVendor(vendorId);
    const communityPuts = communities.map((item) => ({
      item: CommunitiesMapper.withVendorState(item, updated, reviewedAt),
      condition: 'exists' as const,
    }));

    try {
      await this.repository.transactVendorProfile({
        profile: updated,
        expectedStatus: existing.status,
        puts: [{ item: history, condition: 'not_exists' }, ...communityPuts],
      });
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        const current = await this.repository.getVendorById(vendorId);
        if (current?.status === status) {
          return VendorsMapper.toDomain(current);
        }
        throw new ConflictError('Vendor status update conflict');
      }
      throw err;
    }

    const lifecycleEvent = isVendorApproval(existing.status, status)
      ? 'VendorApproved'
      : isVendorRejection(status)
        ? 'VendorRejected'
        : 'VendorUpdated';

    this.logger.info({
      event: lifecycleEvent,
      userId,
      vendorId,
      previousStatus: existing.status,
      newStatus: status,
      correlationId,
    });

    return VendorsMapper.toDomain(updated);
  }

  private async listVendorsInCommunity(params: {
    communityId: string;
    status?: VendorStatus;
    operationalStatus?: OperationalStatus;
    limit?: number;
    lastEvaluatedKey?: Record<string, unknown>;
  }): Promise<VendorPageResult> {
    const page = await this.communitiesRepository.listByCommunity(params);
    const profiles = await this.repository.getVendorsByIds(
      page.items.map((item) => item.vendorId),
    );
    const byId = new Map(profiles.map((item) => [item.vendorId, item]));
    const items = page.items
      .map((item) => byId.get(item.vendorId))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return {
      items,
      lastEvaluatedKey: page.lastEvaluatedKey,
    };
  }

  async updatevendoroperationalstatus(request: LambdaRequest): Promise<Vendor> {
    const vendorId = getVendorId(request);
    const existing = await this.requireVendor(vendorId);
    assertVendorAccess(request, existing);
    const body = request.body as UpdateOperationalStatusRequest;

    this.logger.info({
      event: 'updatevendoroperationalstatus_start',
      vendorId,
      operationalStatus: body?.operationalStatus,
    });

    const decision = assertOperationalStatusAllowed(
      existing.status,
      body.operationalStatus,
    );
    if (decision.kind === 'invalid') {
      throw new ConflictError(decision.message);
    }

    const updated = VendorsMapper.applyOperationalStatusUpdate(
      existing,
      body.operationalStatus,
    );
    const communities = await this.communitiesRepository.listByVendor(vendorId);

    try {
      await this.repository.transactVendorProfile({
        profile: updated,
        expectedUpdatedAt: existing.updatedAt,
        expectedStatus: existing.status,
        puts: communities.map((item) => ({
          item: CommunitiesMapper.withVendorState(item, updated, updated.updatedAt),
          condition: 'exists' as const,
        })),
      });
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Vendor operational status update conflict');
      }
      throw err;
    }

    this.logger.info({
      event: 'updatevendoroperationalstatus_success',
      vendorId,
      operationalStatus: body.operationalStatus,
    });

    return VendorsMapper.toDomain(updated);
  }
}

let service: VendorsService;

function correlationFromContext(): string | undefined {
  const correlationId = getLoggerContext()?.correlationId;
  if (!correlationId || correlationId === 'unknown') {
    return undefined;
  }
  return correlationId;
}

export function getVendorsService() {
  if (!service) {
    service = new VendorsService();
  }

  return service;
}
