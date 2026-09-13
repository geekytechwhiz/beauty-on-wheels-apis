import { LambdaRequest } from '@api-hub/utils';
import {
  ConditionalWriteConflictError,
  NotFoundError,
} from '@api-hub/utils';
import { createLogger, createChildLogger } from '@api-hub/observability';

import {
  VendorsRepository,
  getVendorsRepository,
} from '../repositories/vendors.repository';
import { BankDetailsMapper } from '../mappers/bank-and-branches.mapper';
import { VendorsMapper } from '../mappers/vendors.mapper';
import { BankDetails, BankDetailsData } from '../types/api-types';
import {
  computeStateFromAggregate,
  toVendorAggregate,
} from '../domain/vendor-aggregate';
import { assertVendorAccess, getVendorId } from '../utils/helpers';

const baseLogger = createLogger({
  service: 'bank-details-service',
  redactPII: true,
});

export class BankDetailsService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'BankDetailsService',
  });

  constructor(
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

  async getvendorbankdetails(request: LambdaRequest): Promise<BankDetails> {
    const vendor = await this.requireAccessibleVendor(request);
    const item = await this.vendorsRepository.getBank(vendor.vendorId);
    if (!item) {
      throw new NotFoundError('Bank details not found');
    }
    return BankDetailsMapper.toDomain(item);
  }

  async updatevendorbankdetails(request: LambdaRequest): Promise<BankDetails> {
    const vendor = await this.requireAccessibleVendor(request);
    const body = request.body as BankDetailsData;
    const existing = await this.vendorsRepository.getBank(vendor.vendorId);
    const item = BankDetailsMapper.toDdbItem(vendor.vendorId, body, {
      createdAt: existing?.createdAt,
    });

    const aggregate = toVendorAggregate(
      await this.vendorsRepository.queryVendorItems(vendor.vendorId),
    );
    aggregate.profile = vendor;
    aggregate.bank = item;
    const state = computeStateFromAggregate(aggregate);
    const updatedProfile = VendorsMapper.applyOnboardingState(vendor, {
      ...state,
      primaryBranchId: vendor.primaryBranchId,
      addressCity: aggregate.address?.city,
      addressPostalCode: aggregate.address?.postalCode,
    });

    try {
      await this.vendorsRepository.putSection(
        updatedProfile,
        item as unknown as Record<string, unknown>,
      );
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new NotFoundError('Vendor not found');
      }
      throw err;
    }

    return BankDetailsMapper.toDomain(item);
  }
}

let service: BankDetailsService;

export function getBankDetailsService() {
  if (!service) {
    service = new BankDetailsService();
  }
  return service;
}
