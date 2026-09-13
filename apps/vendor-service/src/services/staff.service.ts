import { randomUUID } from 'crypto';
import { LambdaRequest } from '@api-hub/utils';
import {
  ConflictError,
  ConditionalWriteConflictError,
  NotFoundError,
  ValidationError,
  isConditionalWriteConflictAtIndex,
} from '@api-hub/utils';
import { createLogger, createChildLogger } from '@api-hub/observability';

import {
  StaffRepository,
  getStaffRepository,
  StaffPageResult,
} from '../repositories/staff.repository';
import {
  VendorsRepository,
  getVendorsRepository,
} from '../repositories/vendors.repository';
import { StaffMapper } from '../mappers/staff.mapper';
import {
  CreateStaffRequest,
  Staff,
  StaffListResponse,
  StaffStatus,
  UpdateStaffRequest,
} from '../types/api-types';
import {
  assertVendorAccess,
  decodeCursor,
  encodeCursor,
  getAuthenticatedUserId,
  getPathParam,
  getVendorId,
  parseLimit,
} from '../utils/helpers';

const baseLogger = createLogger({
  service: 'staff-service',
  redactPII: true,
});

const VALID_STAFF_STATUSES: StaffStatus[] = ['ACTIVE', 'INACTIVE'];

export class StaffService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'StaffService',
  });

  constructor(
    private readonly repository: StaffRepository = getStaffRepository(),
    private readonly vendorsRepository: VendorsRepository = getVendorsRepository(),
  ) {}

  private async requireAccessibleVendor(request: LambdaRequest, vendorId: string) {
    const item = await this.vendorsRepository.getVendorById(vendorId);
    if (!item) {
      throw new NotFoundError('Vendor not found');
    }
    assertVendorAccess(request, item);
    return item;
  }

  private toListResponse(result: StaffPageResult): StaffListResponse {
    const nextCursor = encodeCursor(result.lastEvaluatedKey);

    return {
      data: result.items.map((item) => StaffMapper.toDomain(item)),
      pagination: {
        nextCursor,
        hasMore: Boolean(result.lastEvaluatedKey),
      },
    };
  }

  async listvendorstaff(request: LambdaRequest): Promise<StaffListResponse> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);
    const status = request.params?.status as string | undefined;
    const limit = parseLimit(request.params?.limit);
    const lastEvaluatedKey = decodeCursor(request.params?.cursor);

    this.logger.info({
      event: 'listvendorstaff_start',
      userId,
      vendorId,
      status,
      limit,
    });

    try {
      await this.requireAccessibleVendor(request, vendorId);

      if (status && !VALID_STAFF_STATUSES.includes(status as StaffStatus)) {
        throw new ValidationError(
          `Invalid status. Supported values: ${VALID_STAFF_STATUSES.join(', ')}`,
        );
      }

      const result = await this.repository.listStaff({
        vendorId,
        status: status as StaffStatus | undefined,
        limit,
        lastEvaluatedKey,
      });

      const response = this.toListResponse(result);

      this.logger.info({
        event: 'listvendorstaff_success',
        userId,
        vendorId,
        count: response.data?.length ?? 0,
        hasMore: response.pagination?.hasMore,
      });

      return response;
    } catch (error: any) {
      this.logger.error({
        event: 'listvendorstaff_failed',
        userId,
        vendorId,
        error: error.message,
      });
      throw error;
    }
  }

  async createvendorstaff(request: LambdaRequest): Promise<Staff> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);
    const body = request.body as CreateStaffRequest;

    this.logger.info({
      event: 'createvendorstaff_start',
      userId,
      vendorId,
      hasPortalIdentity: Boolean(body?.userId?.trim()),
    });

    try {
      await this.requireAccessibleVendor(request, vendorId);

      const portalUserId = body.userId?.trim() || undefined;
      if (portalUserId) {
        const existingByUser = await this.repository.findStaffByUserId(
          vendorId,
          portalUserId,
        );
        if (existingByUser) {
          throw new ConflictError(
            'Staff member with this user identity already exists for the vendor',
          );
        }
      }

      const staffId = randomUUID();
      const ddbItem = StaffMapper.toDdbItem(body, vendorId, staffId);

      try {
        await this.repository.createStaff(ddbItem);
      } catch (err) {
        if (isConditionalWriteConflictAtIndex(err, 0)) {
          throw new NotFoundError('Vendor not found');
        }
        if (err instanceof ConditionalWriteConflictError) {
          throw new ConflictError('Staff member already exists');
        }
        throw err;
      }

      this.logger.info({
        event: 'createvendorstaff_success',
        userId,
        vendorId,
        staffId,
        associatedUserId: ddbItem.userId,
      });

      return StaffMapper.toDomain(ddbItem);
    } catch (error: any) {
      this.logger.error({
        event: 'createvendorstaff_failed',
        userId,
        vendorId,
        error: error.message,
      });
      throw error;
    }
  }

  async getvendorstaff(request: LambdaRequest): Promise<Staff> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);
    const staffId = getPathParam(request, 'staffId');

    this.logger.info({
      event: 'getvendorstaff_start',
      userId,
      vendorId,
      staffId,
    });

    try {
      await this.requireAccessibleVendor(request, vendorId);
      const item = await this.repository.getStaff(vendorId, staffId);
      if (!item) {
        throw new NotFoundError('Staff member not found');
      }

      this.logger.info({
        event: 'getvendorstaff_success',
        userId,
        vendorId,
        staffId,
      });

      return StaffMapper.toDomain(item);
    } catch (error: any) {
      this.logger.error({
        event: 'getvendorstaff_failed',
        userId,
        vendorId,
        staffId,
        error: error.message,
      });
      throw error;
    }
  }

  async updatevendorstaff(request: LambdaRequest): Promise<Staff> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);
    const staffId = getPathParam(request, 'staffId');
    const body = request.body as UpdateStaffRequest;

    this.logger.info({
      event: 'updatevendorstaff_start',
      userId,
      vendorId,
      staffId,
    });

    try {
      await this.requireAccessibleVendor(request, vendorId);
      const existing = await this.repository.getStaff(vendorId, staffId);
      if (!existing) {
        throw new NotFoundError('Staff member not found');
      }

      const updated = StaffMapper.applyUpdate(existing, body);

      try {
        await this.repository.updateStaff(updated);
      } catch (err) {
        if (err instanceof ConditionalWriteConflictError) {
          throw new ConflictError('Staff update conflict');
        }
        throw err;
      }

      this.logger.info({
        event: 'updatevendorstaff_success',
        userId,
        vendorId,
        staffId,
      });

      return StaffMapper.toDomain(updated);
    } catch (error: any) {
      this.logger.error({
        event: 'updatevendorstaff_failed',
        userId,
        vendorId,
        staffId,
        error: error.message,
      });
      throw error;
    }
  }

  async deactivatevendorstaff(request: LambdaRequest): Promise<void> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);
    const staffId = getPathParam(request, 'staffId');

    this.logger.info({
      event: 'deactivatevendorstaff_start',
      userId,
      vendorId,
      staffId,
    });

    try {
      await this.requireAccessibleVendor(request, vendorId);
      const existing = await this.repository.getStaff(vendorId, staffId);
      if (!existing) {
        throw new NotFoundError('Staff member not found');
      }

      const updated = StaffMapper.applyDeactivate(existing);

      try {
        await this.repository.updateStaff(updated);
      } catch (err) {
        if (err instanceof ConditionalWriteConflictError) {
          throw new NotFoundError('Staff member not found');
        }
        throw err;
      }

      this.logger.info({
        event: 'deactivatevendorstaff_success',
        userId,
        vendorId,
        staffId,
      });
    } catch (error: any) {
      this.logger.error({
        event: 'deactivatevendorstaff_failed',
        userId,
        vendorId,
        staffId,
        error: error.message,
      });
      throw error;
    }
  }
}

let service: StaffService;

export function getStaffService() {
  if (!service) {
    service = new StaffService();
  }

  return service;
}
