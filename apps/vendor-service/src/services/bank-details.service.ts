import { LambdaRequest } from '@api-hub/utils';
import {
  ConditionalWriteConflictError,
  ConflictError,
  NotFoundError,
  isConditionalWriteConflictAtIndex,
} from '@api-hub/utils';

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
import {
  isOnboardingMutable,
  preservedOnboardingStatus,
} from '../domain/onboarding';
import { assertVendorAccess, getVendorId } from '../utils/helpers';
import { VendorBankDdbItem } from '../types/repository.types';

export class BankDetailsService {
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
    if (existing && sameBankDetails(existing, body)) {
      return BankDetailsMapper.toDomain(existing);
    }

    const item = BankDetailsMapper.toDdbItem(vendor.vendorId, body, {
      createdAt: existing?.createdAt,
    });
    const mutable = isOnboardingMutable(vendor.onboardingStatus);

    try {
      if (mutable) {
        const aggregate = toVendorAggregate(
          await this.vendorsRepository.queryVendorItems(vendor.vendorId),
        );
        aggregate.profile = vendor;
        aggregate.bank = item;
        const state = computeStateFromAggregate(aggregate);
        const profile = VendorsMapper.applyOnboardingState(vendor, {
          onboardingStatus: preservedOnboardingStatus(
            vendor.onboardingStatus,
            state.status,
          ),
          currentSection: state.currentSection,
          completedSections: state.completedSections,
          primaryBranchId: vendor.primaryBranchId,
          addressCity: aggregate.address?.city,
          addressPostalCode: aggregate.address?.postalCode,
        });
        await this.vendorsRepository.transactVendorProfile({
          profile,
          expectedUpdatedAt: vendor.updatedAt,
          puts: [{ item: item as unknown as Record<string, unknown> }],
        });
      } else {
        await this.vendorsRepository.replaceVendorChild(
          vendor.vendorId,
          item as unknown as Record<string, unknown>,
        );
      }
    } catch (err) {
      if (isConditionalWriteConflictAtIndex(err, 0) || err instanceof ConditionalWriteConflictError) {
        if (!mutable) {
          throw new NotFoundError('Vendor not found');
        }
        throw new ConflictError('Vendor bank details update conflict');
      }
      throw err;
    }

    return BankDetailsMapper.toDomain(item);
  }
}

function sameBankDetails(existing: VendorBankDdbItem, body: BankDetailsData): boolean {
  return (
    existing.accountHolderName === body.accountHolderName &&
    existing.accountNumber === body.accountNumber &&
    existing.ifscCode === body.ifscCode &&
    existing.bankName === body.bankName &&
    (existing.branchName ?? undefined) === body.branchName &&
    (existing.accountType ?? undefined) === body.accountType
  );
}

let service: BankDetailsService;

export function getBankDetailsService() {
  if (!service) {
    service = new BankDetailsService();
  }
  return service;
}
