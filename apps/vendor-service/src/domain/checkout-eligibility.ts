import { BaseError } from '@api-hub/utils';

import { VendorBranchDdbItem, VendorDdbItem } from '../types/repository.types';

/**
 * Facts Booking needs to decide checkout eligibility.
 * Owner contact details, documents, and bank data stay off this response.
 * `branchId` is present for one-time bookings; package plans omit it.
 */
export interface CheckoutEligibility {
  vendorId: string;
  status: string;
  operationalStatus: string;
  onboardingStatus: string;
  communityIds: string[];
  branchId?: string;
}

function requireVendorEligibilityFields(vendor: VendorDdbItem): {
  status: string;
  operationalStatus: string;
  onboardingStatus: string;
} {
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
  return {
    status: vendor.status,
    operationalStatus: vendor.operationalStatus,
    onboardingStatus: vendor.onboardingStatus,
  };
}

/** Vendor-only eligibility used by community-based package plans. */
export function toVendorCheckoutEligibility(vendor: VendorDdbItem): CheckoutEligibility {
  const fields = requireVendorEligibilityFields(vendor);
  return {
    vendorId: vendor.vendorId,
    ...fields,
    communityIds: (vendor.communityIds ?? []).filter((id) => typeof id === 'string'),
  };
}

export function toCheckoutEligibility(
  vendor: VendorDdbItem,
  branch: VendorBranchDdbItem,
): CheckoutEligibility {
  const fields = requireVendorEligibilityFields(vendor);
  if (branch.vendorId !== vendor.vendorId || branch.branchId.trim() === '') {
    throw new BaseError(
      'Branch does not belong to the selected vendor',
      409,
      'VENDOR_BRANCH_MISMATCH',
    );
  }
  return {
    vendorId: vendor.vendorId,
    ...fields,
    communityIds: (vendor.communityIds ?? []).filter((id) => typeof id === 'string'),
    branchId: branch.branchId,
  };
}
