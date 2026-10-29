import { BaseError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import {
  CheckoutEligibility,
  toCheckoutEligibility,
  toVendorCheckoutEligibility,
} from '../domain/checkout-eligibility';
import { BranchesRepository, getBranchesRepository } from '../repositories/branches.repository';
import { getVendorsRepository, VendorsRepository } from '../repositories/vendors.repository';

const logger = createChildLogger(
  createLogger({ service: 'vendor-service', redactPII: true }),
  { service: 'CheckoutEligibilityService' },
);

/**
 * Live vendor (and optional branch) check used by Booking Service.
 * The booking-readiness projection is a vendor dashboard read model and is not
 * an authorization decision for creating a customer booking.
 * Package plans call this without a branchId.
 */
export class CheckoutEligibilityService {
  constructor(
    private readonly vendors: VendorsRepository = getVendorsRepository(),
    private readonly branches: BranchesRepository = getBranchesRepository(),
  ) {}

  async get(vendorId: string, branchId?: string): Promise<CheckoutEligibility> {
    const vendor = await this.vendors.getVendorById(vendorId);
    if (!vendor) {
      throw new BaseError(`Vendor not found: ${vendorId}`, 404, 'VENDOR_NOT_FOUND');
    }
    if (!branchId) {
      const eligibility = toVendorCheckoutEligibility(vendor);
      logger.info({
        event: 'checkout_eligibility_read',
        vendorId,
        mode: 'vendor_only',
      });
      return eligibility;
    }
    const branch = await this.branches.getBranch(vendorId, branchId);
    if (!branch) {
      throw new BaseError(
        'Branch does not belong to the selected vendor',
        409,
        'VENDOR_BRANCH_MISMATCH',
      );
    }
    const eligibility = toCheckoutEligibility(vendor, branch);
    logger.info({
      event: 'checkout_eligibility_read',
      vendorId,
      branchId,
    });
    return eligibility;
  }
}

let service: CheckoutEligibilityService | undefined;

export function getCheckoutEligibilityService(): CheckoutEligibilityService {
  if (!service) {
    service = new CheckoutEligibilityService();
  }
  return service;
}
