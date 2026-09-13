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
import { VendorsMapper } from '../mappers/vendors.mapper';
import { OwnerMapper } from '../mappers/owner.mapper';
import {
  CreateVendorRequest,
  OperationalStatus,
  UpdateOperationalStatusRequest,
  UpdateVendorRequest,
  UpdateVendorStatusRequest,
  Vendor,
  VendorListResponse,
  VendorStatus,
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
  CONFIRMED_VENDOR_STATUS,
  VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
  generateVendorEmailVerificationOtp,
} from '../domain/email-verification';

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
    const limit = parseLimit(request.params?.limit);
    const lastEvaluatedKey = decodeCursor(request.params?.cursor);

    this.logger.info({
      event: 'listvendors_start',
      userId,
      status,
      operationalStatus,
      city,
      postalCode,
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

    let result: VendorPageResult;

    if (city) {
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

    this.logger.info({
      event: 'updatevendorstatus_start',
      userId,
      vendorId,
      status: body?.status,
    });

    const existing = await this.requireVendor(vendorId);
    const transitioningToConfirmed =
      existing.status !== CONFIRMED_VENDOR_STATUS &&
      body.status === CONFIRMED_VENDOR_STATUS;
    const correlationId = getLoggerContext()?.correlationId;
    const updated = VendorsMapper.applyStatusUpdate(existing, body.status, {
      verification: transitioningToConfirmed
        ? {
            emailVerificationOtp: generateVendorEmailVerificationOtp(),
            emailVerificationExpiryMinutes:
              VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
            emailVerificationRequestedAt: new Date().toISOString(),
          }
        : undefined,
      meta:
        correlationId && correlationId !== 'unknown'
          ? { correlationId }
          : undefined,
    });

    try {
      await this.repository.updateVendor(updated);
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Vendor status update conflict');
      }
      throw err;
    }

    this.logger.info({
      event: 'updatevendorstatus_success',
      userId,
      vendorId,
      status: body.status,
    });

    return VendorsMapper.toDomain(updated);
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

    const updated = VendorsMapper.applyOperationalStatusUpdate(
      existing,
      body.operationalStatus,
    );

    try {
      await this.repository.updateVendor(updated);
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

export function getVendorsService() {
  if (!service) {
    service = new VendorsService();
  }

  return service;
}
