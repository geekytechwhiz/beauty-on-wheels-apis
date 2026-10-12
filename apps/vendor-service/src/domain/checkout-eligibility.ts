import { BaseError } from '@api-hub/utils';

import { VendorBranchDdbItem, VendorDdbItem } from '../types/repository.types';

/**
 * Facts Booking needs to decide checkout eligibility.
 * Owner contact details, documents, and bank data stay off this response.
 */
export interface CheckoutEligibility {
  vendorId: string;
  status: string;
  operationalStatus: string;
  onboardingStatus: string;
  communityIds: string[];
  branchId: string;
}

export function toCheckoutEligibility(
  vendor: VendorDdbItem,
  branch: VendorBranchDdbItem,
): CheckoutEligibility {
  if (
    typeof vendor.status !== 'string'
    || typeof vendor.operationalStatus !== 'string'
    || typeof vendor.onboardingStatus !== 'string'
  ) {
    throw new BaseError(
      'Vendor eligibility is incomplete',
      502,
      'VENDOR_ELIGIBILITY_UNAVAILABLE',
    );
  }
  if (branch.vendorId !== vendor.vendorId || branch.branchId.trim() === '') {
    throw new BaseError(
      'Branch does not belong to the selected vendor',
      409,
      'VENDOR_BRANCH_MISMATCH',
    );
  }
  return {
    vendorId: vendor.vendorId,
    status: vendor.status,
    operationalStatus: vendor.operationalStatus,
    onboardingStatus: vendor.onboardingStatus,
    communityIds: (vendor.communityIds ?? []).filter((id) => typeof id === 'string'),
    branchId: branch.branchId,
  };
}
