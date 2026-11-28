import { createLogger } from '@api-hub/observability';
import { apiClients, BaseError, ForbiddenError } from '@api-hub/utils';

import type {
  PartnerActor,
  PartnerInternalClient,
} from '../../clients/partner-internal.client';
import { isPlatformAdminActor } from '../../shared/actor';
import {
  emptyCapacity,
  isDashboardEligible,
  mapCommitments,
  mapHomeSection,
  mapPendingProposals,
  mapVendorSection,
} from './vendor-home.mappers';
import {
  VENDOR_HOME_MEMBERSHIP_ROLE,
  VENDOR_HOME_SECTION,
  type VendorHomeQuery,
  type VendorHomeResponse,
  type VendorHomeUnavailableSection,
} from './vendor-home.types';
import { BookingInternalClient } from '../../clients/booking-internal.client';

/**
 * Composes the client-facing vendor home dashboard from approved domain
 * capabilities. Authorization is enforced before any vendor-scoped load.
 *
 * Core dependencies: membership (already resolved), vendor context, and
 * operational home summary for owners/admins when the dashboard is eligible.
 * Optional widgets: capacity proposals and commitments.
 *
 * Explicit policy: booking home-summary remains owner-or-admin. Staff with
 * active membership may receive vendor context (and capacity when permitted),
 * but the operational `home` section is not loaded for them.
 */
export class VendorHomeService {
  constructor(
    private readonly client: PartnerInternalClient,
    private readonly bookingClient: BookingInternalClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private readonly logger = createLogger({ name: 'VendorHomeService' });

  async get(
    actor: PartnerActor,
    query: VendorHomeQuery,
  ): Promise<VendorHomeResponse> {
    const generatedAt = this.now().toISOString();

    const contextResult = await this.client.readVendor(actor, {
      includeVendorContext: true,
    });
    if (!contextResult.vendorContext) {
      throw new BaseError(
        'Vendor context is unavailable',
        502,
        'DEPENDENCY_UNAVAILABLE',
        undefined,
        { retryable: true },
      );
    }

    const vendor = mapVendorSection(contextResult.vendorContext, actor.vendorId);
    const dashboardEligible = isDashboardEligible(vendor.nextAction);
    const isOwner =
      vendor.membership.role === VENDOR_HOME_MEMBERSHIP_ROLE.OWNER;
    const isAdmin = isPlatformAdminActor(actor.roles);
    const canLoadHome = dashboardEligible && (isOwner || isAdmin);
    const capacityAllowed =
      dashboardEligible &&
      canLoadCapacity(actor, vendor.membership.permissions);

    if (!dashboardEligible) {
      return {
        vendor,
        home: null,
        capacity: emptyCapacity(),
        meta: {
          generatedAt,
          partialData: false,
          unavailableSections: [],
          dashboardEligible: false,
        },
      };
    }

    const unavailableSections: VendorHomeUnavailableSection[] = [];
    let home: VendorHomeResponse['home'] = null;

    const homePromise = canLoadHome
      ? this.client.readHomeSummary(actor, {
          ...(query.date ? { date: query.date } : {}),
          upcomingDays: query.upcomingDays,
        })
      : Promise.resolve(null);

    const proposalsPromise = capacityAllowed
      ? this.client.readVendor(actor, {
          includeProposals: true,
          proposalStatuses: ['SENT', 'COUNTERED'],
        })
      : Promise.resolve(null);

    const commitmentsPromise = capacityAllowed
      ? this.client.readVendor(actor, { includeCommitments: true })
      : Promise.resolve(null);

    const [homeResult, proposalsResult, commitmentsResult] =
      await Promise.allSettled([
        homePromise,
        proposalsPromise,
        commitmentsPromise,
      ]);

    if (canLoadHome) {
      if (homeResult.status === 'fulfilled' && homeResult.value) {
        home = mapHomeSection(homeResult.value);
      } else if (homeResult.status === 'rejected') {
        const reason = homeResult.reason;
        if (isForbidden(reason)) throw reason;
        this.logger.warn({
          event: 'vendor_home_summary_unavailable',
          vendorId: actor.vendorId,
          correlationId: actor.correlationId,
        });
        throwCore(reason);
      }
    } else if (vendor.membership.role === VENDOR_HOME_MEMBERSHIP_ROLE.STAFF) {
      unavailableSections.push(VENDOR_HOME_SECTION.HOME);
    }

    let pendingProposals = emptyCapacity().pendingProposals;
    let commitments = emptyCapacity().commitments;

    if (capacityAllowed) {
      if (
        proposalsResult.status === 'fulfilled' &&
        proposalsResult.value &&
        !proposalsResult.value.unavailableSections?.includes('proposals')
      ) {
        pendingProposals = mapPendingProposals(
          proposalsResult.value.proposals ?? [],
          this.now(),
        );
      } else {
        unavailableSections.push(VENDOR_HOME_SECTION.CAPACITY_PENDING_PROPOSALS);
        this.logger.warn({
          event: 'vendor_home_proposals_unavailable',
          vendorId: actor.vendorId,
          correlationId: actor.correlationId,
        });
      }

      if (
        commitmentsResult.status === 'fulfilled' &&
        commitmentsResult.value &&
        !commitmentsResult.value.unavailableSections?.includes('commitments')
      ) {
        commitments = mapCommitments(commitmentsResult.value.commitments ?? []);
      } else {
        unavailableSections.push(VENDOR_HOME_SECTION.CAPACITY_COMMITMENTS);
        this.logger.warn({
          event: 'vendor_home_commitments_unavailable',
          vendorId: actor.vendorId,
          correlationId: actor.correlationId,
        });
      }
    }

    return {
      vendor,
      home,
      capacity: { pendingProposals, commitments },
      meta: {
        generatedAt,
        partialData: unavailableSections.length > 0,
        unavailableSections: [...new Set(unavailableSections)],
        dashboardEligible: true,
      },
    };
  }

  async getVendorHome(
    vendorId: string,
    accessToken?: string,
  ): Promise<any> {
    const homeResult = await this.bookingClient.readVendorBookings(
      vendorId,
      accessToken,
    );
    // return mapHomeSection(homeResult);
    return homeResult;
  }
}

function canLoadCapacity(
  actor: PartnerActor,
  membershipPermissions: readonly string[],
): boolean {
  if (isPlatformAdminActor(actor.roles)) return true;
  const grants = new Set([...actor.permissions, ...membershipPermissions]);
  return grants.has('communities:manage');
}

function isForbidden(error: unknown): boolean {
  return (
    error instanceof ForbiddenError ||
    (error instanceof BaseError && error.statusCode === 403)
  );
}

function throwCore(error: unknown): never {
  if (error instanceof BaseError) throw error;
  throw new BaseError(
    'Vendor home summary is unavailable',
    502,
    'DEPENDENCY_UNAVAILABLE',
    undefined,
    { retryable: true },
  );
}
