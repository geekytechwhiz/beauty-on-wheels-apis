/* eslint-disable mvrx/no-controller-business-logic */
import { BaseError } from '@api-hub/utils';

import { getCheckoutEligibilityService } from '../services/checkout-eligibility.service';
import { getSchedulingCrewsService } from '../services/scheduling-crews.service';
import { getVendorsService } from '../services/vendors.service';
import { getCommunitiesRepository } from '../repositories/communities.repository';
import { getCapacityCommitmentLookupService } from '../services/capacity-commitment-lookup.service';
import { getDiscoveryFactsService } from '../services/discovery-facts.service';
import { getPricingConfigurationService } from '../services/pricing-configuration.service';
import { getSoldCapacityService } from '../services/sold-capacity.service';
import { getCommunitiesService } from '../services/communities.service';
import { getCapacityProposalsService } from '../services/capacity-proposals.service';

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
    const branchId = typeof event?.branchId === 'string' && event.branchId.trim()
      ? event.branchId.trim()
      : undefined;
    const data = await getCheckoutEligibilityService().get(vendorId, branchId);
    return { data };
  } catch (error) {
    return failure(error);
  }
};

/**
 * Owner or staff membership for a verified application user id.
 * No HTTP route. Booking compares the result with the path vendor id.
 */
/**
 * Crew roster and current staff status for one vendor.
 * No HTTP route. Booking authorizes the caller before invoking this function.
 * Phone numbers and email addresses are not returned; only partnerManagerRead
 * adds the crew point of contact.
 */
export const listSchedulingCrews = async (event: {
  vendorId?: unknown;
} | null): Promise<unknown> => {
  try {
    const vendorId = requireId(event?.vendorId, 'vendorId');
    const data = await getSchedulingCrewsService().list(vendorId);
    return { data };
  } catch (error) {
    return failure(error);
  }
};

export const getOperationalAccess = async (event: {
  userId?: unknown;
} | null): Promise<unknown> => {
  try {
    const userId = requireId(event?.userId, 'userId');
    const data = await getVendorsService().resolveOperationalAccess(userId);
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
/**
 * Confirms / reacquires durable sold capacity for a paid plan (converts hold or reserves).
 * No HTTP route. Booking invokes at payment success.
 */
export const reserveSoldCapacity = async (event: {
  vendorId?: unknown;
  communityId?: unknown;
  offeringId?: unknown;
  demandQuantity?: unknown;
  planId?: unknown;
  paymentId?: unknown;
  expiresAt?: unknown;
  kind?: unknown;
} | null): Promise<unknown> => {
  try {
    const input = parseCapacityEvent(event);
    const data = input.kind === 'hold'
      ? await getSoldCapacityService().holdPlanCapacity(input)
      : await getSoldCapacityService().confirmPlanCapacity(input);
    return { data };
  } catch (error) {
    return failure(error);
  }
};

/** Temporary checkout hold. No HTTP route. Booking invokes at payment initiate. */
export const holdSoldCapacity = async (event: {
  vendorId?: unknown;
  communityId?: unknown;
  offeringId?: unknown;
  demandQuantity?: unknown;
  planId?: unknown;
  paymentId?: unknown;
  expiresAt?: unknown;
} | null): Promise<unknown> => {
  try {
    const input = parseCapacityEvent(event);
    if (!input.expiresAt) {
      throw new BaseError('expiresAt is required for a capacity hold', 400, 'VALIDATION_ERROR');
    }
    const data = await getSoldCapacityService().holdPlanCapacity(input);
    return { data };
  } catch (error) {
    return failure(error);
  }
};

/** Converts hold→sold or reacquires after expiry. No HTTP route. */
export const confirmSoldCapacity = async (event: {
  vendorId?: unknown;
  communityId?: unknown;
  offeringId?: unknown;
  demandQuantity?: unknown;
  planId?: unknown;
  paymentId?: unknown;
} | null): Promise<unknown> => {
  try {
    const data = await getSoldCapacityService().confirmPlanCapacity(parseCapacityEvent(event));
    return { data };
  } catch (error) {
    return failure(error);
  }
};

/** Releases held or sold capacity for a plan (fail/cancel/expire/refund). No HTTP route. */
export const releaseSoldCapacity = async (event: {
  planId?: unknown;
} | null): Promise<unknown> => {
  try {
    const planId = requireId(event?.planId, 'planId');
    await getSoldCapacityService().releasePlanCapacity({ planId });
    return { data: { released: true } };
  } catch (error) {
    return failure(error);
  }
};

/**
 * Reserves visit slot-units against a commitment service day when a package visit
 * is scheduled. No HTTP route. Booking invokes from schedule/reschedule.
 */
export const reserveVisitSoldCapacity = async (event: {
  vendorId?: unknown;
  communityId?: unknown;
  offeringId?: unknown;
  planId?: unknown;
  visitId?: unknown;
  date?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  demandQuantity?: unknown;
} | null): Promise<unknown> => {
  try {
    const data = await getSoldCapacityService().reserveVisitCapacity(parseVisitCapacityEvent(event));
    return { data };
  } catch (error) {
    return failure(error);
  }
};

/** Releases a visit sold-capacity debit (cancel / reschedule-away). No HTTP route. */
export const releaseVisitSoldCapacity = async (event: {
  visitId?: unknown;
} | null): Promise<unknown> => {
  try {
    const visitId = requireId(event?.visitId, 'visitId');
    await getSoldCapacityService().releaseVisitCapacity({ visitId });
    return { data: { released: true } };
  } catch (error) {
    return failure(error);
  }
};

function parseCapacityEvent(event: {
  vendorId?: unknown;
  communityId?: unknown;
  offeringId?: unknown;
  demandQuantity?: unknown;
  planId?: unknown;
  paymentId?: unknown;
  expiresAt?: unknown;
  kind?: unknown;
} | null) {
  const vendorId = requireId(event?.vendorId, 'vendorId');
  const communityId = requireId(event?.communityId, 'communityId');
  const offeringId = requireId(event?.offeringId, 'offeringId');
  const planId = requireId(event?.planId, 'planId');
  const demandQuantity = event?.demandQuantity;
  if (typeof demandQuantity !== 'number' || !Number.isInteger(demandQuantity) || demandQuantity < 1) {
    throw new BaseError('demandQuantity must be a positive integer', 400, 'VALIDATION_ERROR');
  }
  const paymentId = typeof event?.paymentId === 'string' && event.paymentId.trim()
    ? event.paymentId.trim()
    : undefined;
  const expiresAt = typeof event?.expiresAt === 'string' && event.expiresAt.trim()
    ? event.expiresAt.trim()
    : undefined;
  const kind = event?.kind === 'hold' ? 'hold' as const : event?.kind === 'sold' ? 'sold' as const : undefined;
  return {
    vendorId,
    communityId,
    offeringId,
    demandQuantity,
    planId,
    ...(paymentId ? { paymentId } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(kind ? { kind } : {}),
  };
}

function parseVisitCapacityEvent(event: {
  vendorId?: unknown;
  communityId?: unknown;
  offeringId?: unknown;
  planId?: unknown;
  visitId?: unknown;
  date?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  demandQuantity?: unknown;
} | null) {
  const vendorId = requireId(event?.vendorId, 'vendorId');
  const communityId = requireId(event?.communityId, 'communityId');
  const offeringId = requireId(event?.offeringId, 'offeringId');
  const planId = requireId(event?.planId, 'planId');
  const visitId = requireId(event?.visitId, 'visitId');
  const date = requireId(event?.date, 'date');
  const startTime = requireId(event?.startTime, 'startTime');
  const endTime = requireId(event?.endTime, 'endTime');
  const demandQuantity = event?.demandQuantity;
  if (typeof demandQuantity !== 'number' || !Number.isInteger(demandQuantity) || demandQuantity < 1) {
    throw new BaseError('demandQuantity must be a positive integer', 400, 'VALIDATION_ERROR');
  }
  return {
    vendorId,
    communityId,
    offeringId,
    planId,
    visitId,
    date,
    startTime,
    endTime,
    demandQuantity,
  };
}

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

/**
 * Partner BFF's IAM-only manager read surface. It is not an HTTP endpoint.
 * Lambda invocation authorization establishes the workload boundary; this
 * handler re-resolves the delegated actor against the canonical Vendor
 * membership so a BFF role cannot read an arbitrary vendor's data.
 * Crews carry `pointOfContact` (including phone) for the verified owner only.
 */
export const partnerManagerRead = async (event: {
  actor?: unknown;
  includeCrews?: unknown;
  includeCommitments?: unknown;
  communityIds?: unknown;
} | null): Promise<unknown> => {
  try {
    const actor = parsePartnerActor(event?.actor);
    const membership = await getVendorsService().resolveOperationalAccess(actor.userId);
    if (!membership.active || membership.role !== 'owner' || membership.vendorId !== actor.vendorId) {
      throw new BaseError('Delegated actor is not authorized for this vendor', 403, 'FORBIDDEN');
    }
    const request = delegatedRequest(actor);
    const communityIds = parseCommunityIds(event?.communityIds);
    // Commitments are optional enrichment for the BFF; their failure must not hide crews.
    const commitmentsRead = event?.includeCommitments === true
      ? getCapacityCommitmentLookupServiceForPartner(request).catch(() => COMMITMENTS_UNAVAILABLE)
      : undefined;
    const [crews, commitments, communities] = await Promise.all([
      event?.includeCrews === true
        ? getSchedulingCrewsService().list(actor.vendorId, { includePointOfContact: true })
        : undefined,
      commitmentsRead,
      communityIds.length > 0
        ? getCommunitiesService().listPartnerCommunityDirectory({
          ...request,
          params: { ids: communityIds.join(',') },
        })
        : undefined,
    ]);
    return {
      data: {
        ...(crews ? { crews: crews.crews } : {}),
        ...(commitments && commitments !== COMMITMENTS_UNAVAILABLE ? { commitments } : {}),
        ...(commitments === COMMITMENTS_UNAVAILABLE ? { unavailableSections: ['commitments'] } : {}),
        ...(communities ? { communities: communities.data.items.map((item) => ({ communityId: item.communityId, name: item.name })) } : {}),
        sourceAsOf: new Date().toISOString(),
      },
    };
  } catch (error) {
    return failure(error);
  }
};

const COMMITMENTS_UNAVAILABLE = Symbol('commitmentsUnavailable');

function getCapacityCommitmentLookupServiceForPartner(request: import('@api-hub/utils').LambdaRequest) {
  return getCapacityProposalsService().listvendorcapacitycommitments(request).then((result) => result.data.items);
}

function parsePartnerActor(value: unknown): {
  userId: string;
  vendorId: string;
  roles: string[];
  permissions: string[];
  correlationId: string;
} {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const userId = typeof source.userId === 'string' ? source.userId.trim() : '';
  const vendorId = typeof source.vendorId === 'string' ? source.vendorId.trim() : '';
  const correlationId = typeof source.correlationId === 'string' ? source.correlationId.trim() : '';
  const roles = Array.isArray(source.roles) ? source.roles.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
  if (!userId || !vendorId || !correlationId) throw new BaseError('Delegated actor is required', 401, 'UNAUTHORIZED');
  const managerRole = roles.some((role) =>
    ['root', 'admin', 'vendor', 'vendor_manager', 'vendor_owner', 'manager', 'owner'].includes(
      role.trim().toLowerCase().replace(/[\s-]+/g, '_'),
    ),
  );
  if (!managerRole) throw new BaseError('Partner manager access is required', 403, 'FORBIDDEN');
  return { userId, vendorId, roles, permissions: [], correlationId };
}

function parseCommunityIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new BaseError('communityIds must contain at most 100 ids', 400, 'VALIDATION_ERROR');
  return [...new Set(value.map((item) => {
    if (typeof item !== 'string' || !DIRECTORY_COMMUNITY_ID.test(item.trim())) {
      throw new BaseError('Invalid communityId', 400, 'VALIDATION_ERROR');
    }
    return item.trim();
  }))];
}

function delegatedRequest(actor: {
  userId: string;
  vendorId: string;
  roles: string[];
  permissions: string[];
  correlationId: string;
}): import('@api-hub/utils').LambdaRequest {
  return {
    pathParameters: { vendorId: actor.vendorId },
    params: {},
    event: {} as import('@api-hub/utils').LambdaRequest['event'],
    context: {
      correlationId: actor.correlationId,
      awsRequestId: actor.correlationId,
      logger: undefined,
      authContext: {
        identityId: 'partner-bff-delegated',
        userId: actor.userId,
        roles: actor.roles,
        permissions: actor.permissions,
        claims: {},
      },
    },
  };
}

/**
 * Holding-status facts for Catalog sales-control enablement.
 * No HTTP route. Missing ids are omitted; Catalog fails closed on the gap.
 */
export const lookupCapacityCommitments = async (event: {
  commitmentIds?: unknown;
} | null): Promise<unknown> => {
  try {
    if (!Array.isArray(event?.commitmentIds)) {
      throw new BaseError('commitmentIds is required', 400, 'VALIDATION_ERROR');
    }
    const data = await getCapacityCommitmentLookupService().lookup(
      event.commitmentIds as string[],
    );
    return { data: { commitments: data } };
  } catch (error) {
    return failure(error);
  }
};
