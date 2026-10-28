/* eslint-disable mvrx/no-controller-business-logic */
import { BaseError } from '@api-hub/utils';

import { getCheckoutEligibilityService } from '../services/checkout-eligibility.service';
import { getCommunitiesRepository } from '../repositories/communities.repository';
import { getDiscoveryFactsService } from '../services/discovery-facts.service';
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

/**
 * Approval, branch location, service-area coverage, and service prices.
 * No HTTP route. Contact details are not included.
 */
export const getDiscoveryFacts = async (event: {
  vendorId?: unknown;
} | null): Promise<unknown> => {
  try {
    const vendorId = requireId(event?.vendorId, 'vendorId');
    const data = await getDiscoveryFactsService().get(vendorId);
    return { data };
  } catch (error) {
    return failure(error);
  }
};

const DIRECTORY_COMMUNITY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Active platform directory ids. Inactive and unknown ids are omitted.
 * No HTTP route. The caller cannot ask this function to approve an offering.
 */
export const lookupActiveCommunities = async (event: {
  communityIds?: unknown;
} | null): Promise<unknown> => {
  try {
    if (!Array.isArray(event?.communityIds) || event.communityIds.length < 1 || event.communityIds.length > 25) {
      throw new BaseError('communityIds must contain 1 to 25 ids', 400, 'VALIDATION_ERROR');
    }
    const communityIds: string[] = [];
    for (const value of event.communityIds) {
      if (typeof value !== 'string' || !DIRECTORY_COMMUNITY_ID.test(value)) {
        throw new BaseError('Invalid communityId', 400, 'VALIDATION_ERROR');
      }
      communityIds.push(value);
    }
    const communities = getCommunitiesRepository();
    const active: string[] = [];
    for (const communityId of communityIds) {
      const item = await communities.getActiveCommunity(communityId);
      if (item) {
        active.push(communityId);
      }
    }
    return { data: { communityIds: active } };
  } catch (error) {
    return failure(error);
  }
};
