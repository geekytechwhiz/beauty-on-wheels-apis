import { BaseError } from '@api-hub/utils';

import { getCheckoutEligibilityService } from '../services/checkout-eligibility.service';
import { getPricingConfigurationService } from '../services/pricing-configuration.service';

interface InternalErrorBody {
  code: string;
  message: string;
  statusCode: number;
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BaseError(`${field} is required`, 400, 'VALIDATION_ERROR');
  }
  return value.trim();
}

function failure(error: unknown): { error: InternalErrorBody } | never {
  if (error instanceof BaseError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
      },
    };
  }
  throw error;
}

/**
 * Direct Lambda invoke for same-account application roles.
 * There is no HTTP route and no caller-supplied internal flag.
 */
export const getCheckoutEligibility = async (event: {
  vendorId?: unknown;
  branchId?: unknown;
} | null): Promise<unknown> => {
  try {
    const vendorId = requireId(event?.vendorId, 'vendorId');
    const branchId = requireId(event?.branchId, 'branchId');
    const data = await getCheckoutEligibilityService().get(vendorId, branchId);
    return { data };
  } catch (error) {
    return failure(error);
  }
};

export const getPricingConfiguration = async (event: {
  vendorId?: unknown;
} | null): Promise<unknown> => {
  try {
    const vendorId = requireId(event?.vendorId, 'vendorId');
    const data = await getPricingConfigurationService().get(vendorId);
    return { data };
  } catch (error) {
    return failure(error);
  }
};
