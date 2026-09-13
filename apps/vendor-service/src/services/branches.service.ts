import { randomUUID } from 'crypto';
import { LambdaRequest } from '@api-hub/utils';
import {
  ConflictError,
  ConditionalWriteConflictError,
  NotFoundError,
  isConditionalWriteConflictAtIndex,
} from '@api-hub/utils';
import { createLogger, createChildLogger } from '@api-hub/observability';

import {
  BranchesRepository,
  getBranchesRepository,
} from '../repositories/branches.repository';
import {
  VendorsRepository,
  getVendorsRepository,
} from '../repositories/vendors.repository';
import { BranchesMapper } from '../mappers/bank-and-branches.mapper';
import { VendorsMapper } from '../mappers/vendors.mapper';
import {
  CreateBranchRequest,
  UpdateBranchRequest,
  VendorBranch,
} from '../types/api-types';
import {
  computeStateFromAggregate,
  toVendorAggregate,
} from '../domain/vendor-aggregate';
import {
  assertVendorAccess,
  getPathParam,
  getVendorId,
} from '../utils/helpers';

const baseLogger = createLogger({
  service: 'branches-service',
  redactPII: true,
});

export class BranchesService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'BranchesService',
  });

  constructor(
    private readonly repository: BranchesRepository = getBranchesRepository(),
    private readonly vendorsRepository: VendorsRepository = getVendorsRepository(),
  ) {}

  private async requireAccessibleVendor(request: LambdaRequest) {
    const vendorId = getVendorId(request);
    const vendor = await this.vendorsRepository.getVendorById(vendorId);
    if (!vendor) {
      throw new NotFoundError('Vendor not found');
    }
    assertVendorAccess(request, vendor);
    return vendor;
  }

  private async syncOnboarding(vendorId: string): Promise<void> {
    const vendor = await this.vendorsRepository.getVendorById(vendorId);
    if (!vendor) {
      return;
    }
    const aggregate = toVendorAggregate(
      await this.vendorsRepository.queryVendorItems(vendorId),
    );
    aggregate.profile = vendor;
    const state = computeStateFromAggregate(aggregate);
    const updated = VendorsMapper.applyOnboardingState(vendor, {
      ...state,
      primaryBranchId: vendor.primaryBranchId,
      addressCity: aggregate.address?.city,
      addressPostalCode: aggregate.address?.postalCode,
    });
    await this.vendorsRepository.updateVendor(updated);
  }

  async listvendorbranches(
    request: LambdaRequest,
  ): Promise<{ data: VendorBranch[] }> {
    const vendor = await this.requireAccessibleVendor(request);
    const items = await this.repository.listBranches(vendor.vendorId);
    return { data: items.map((item) => BranchesMapper.toDomain(item)) };
  }

  async createvendorbranch(request: LambdaRequest): Promise<VendorBranch> {
    const vendor = await this.requireAccessibleVendor(request);
    const body = request.body as CreateBranchRequest;
    const branchId = randomUUID();
    const existing = await this.repository.listBranches(vendor.vendorId);
    const isPrimary = body.isPrimary ?? existing.length === 0;
    const ddbItem = BranchesMapper.toDdbItem(body, vendor.vendorId, branchId, {
      isPrimary,
    });

    try {
      await this.repository.createBranch(ddbItem);
    } catch (err) {
      if (isConditionalWriteConflictAtIndex(err, 0)) {
        throw new NotFoundError('Vendor not found');
      }
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Branch already exists');
      }
      throw err;
    }

    if (isPrimary && vendor.primaryBranchId !== branchId) {
      vendor.primaryBranchId = branchId;
      await this.vendorsRepository.updateVendor(vendor);
    }

    await this.syncOnboarding(vendor.vendorId);
    return BranchesMapper.toDomain(ddbItem);
  }

  async getvendorbranch(request: LambdaRequest): Promise<VendorBranch> {
    const vendor = await this.requireAccessibleVendor(request);
    const branchId = getPathParam(request, 'branchId');
    const item = await this.repository.getBranch(vendor.vendorId, branchId);
    if (!item) {
      throw new NotFoundError('Branch not found');
    }
    return BranchesMapper.toDomain(item);
  }

  async updatevendorbranch(request: LambdaRequest): Promise<VendorBranch> {
    const vendor = await this.requireAccessibleVendor(request);
    const branchId = getPathParam(request, 'branchId');
    const body = request.body as UpdateBranchRequest;
    const existing = await this.repository.getBranch(vendor.vendorId, branchId);
    if (!existing) {
      throw new NotFoundError('Branch not found');
    }

    const updated = BranchesMapper.applyUpdate(existing, body);

    try {
      await this.repository.updateBranch(updated);
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Branch update conflict');
      }
      throw err;
    }

    if (updated.isPrimary) {
      vendor.primaryBranchId = branchId;
      await this.vendorsRepository.updateVendor(vendor);
    }

    await this.syncOnboarding(vendor.vendorId);
    return BranchesMapper.toDomain(updated);
  }

  async deletevendorbranch(request: LambdaRequest): Promise<void> {
    const vendor = await this.requireAccessibleVendor(request);
    const branchId = getPathParam(request, 'branchId');
    const existing = await this.repository.getBranch(vendor.vendorId, branchId);
    if (!existing) {
      throw new NotFoundError('Branch not found');
    }

    try {
      await this.repository.deleteBranch(vendor.vendorId, branchId);
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new NotFoundError('Branch not found');
      }
      throw err;
    }

    if (vendor.primaryBranchId === branchId) {
      const remaining = await this.repository.listBranches(vendor.vendorId);
      vendor.primaryBranchId = remaining[0]?.branchId;
      await this.vendorsRepository.updateVendor(vendor);
    }

    await this.syncOnboarding(vendor.vendorId);
  }
}

let service: BranchesService;

export function getBranchesService() {
  if (!service) {
    service = new BranchesService();
  }
  return service;
}
