import { BaseError } from '@api-hub/utils';

import type {
  CapacityCommitmentSource,
  CapacityProposalSource,
  VendorContextSource,
  VendorHomeSummarySource,
} from '../../clients/partner-internal.client';
import {
  VENDOR_HOME_COMMITMENT_STATUS,
  VENDOR_HOME_MEMBERSHIP_ROLE,
  VENDOR_HOME_PROPOSAL_STATUS,
  type VendorHomeCapacitySection,
  type VendorHomeCommitment,
  type VendorHomePendingProposal,
  type VendorHomeSection,
  type VendorHomeVendorSection,
} from './vendor-home.types';

const OPEN_DASHBOARD = 'OPEN_VENDOR_DASHBOARD';

export function isDashboardEligible(nextAction: string): boolean {
  return nextAction === OPEN_DASHBOARD;
}

export function mapVendorSection(
  source: VendorContextSource,
  fallbackVendorId: string,
): VendorHomeVendorSection {
  const role =
    source.membership?.role === VENDOR_HOME_MEMBERSHIP_ROLE.STAFF
      ? VENDOR_HOME_MEMBERSHIP_ROLE.STAFF
      : VENDOR_HOME_MEMBERSHIP_ROLE.OWNER;
  return {
    vendorId: source.vendorId?.trim() || fallbackVendorId,
    membership: {
      role,
      permissions: Array.isArray(source.membership?.permissions)
        ? source.membership.permissions.filter(
            (item): item is string => typeof item === 'string' && Boolean(item.trim()),
          )
        : [],
      ...(source.membership?.staffId?.trim()
        ? { staffId: source.membership.staffId.trim() }
        : {}),
    },
    status: source.status?.trim() || 'UNKNOWN',
    ...(source.onboarding
      ? {
          onboarding: {
            ...(source.onboarding.currentStep
              ? { currentStep: source.onboarding.currentStep }
              : {}),
            ...(typeof source.onboarding.completed === 'boolean'
              ? { completed: source.onboarding.completed }
              : {}),
          },
        }
      : {}),
    nextAction: source.nextAction?.trim() || 'VIEW_ACCOUNT_STATUS',
    ...(source.detailsAcceptance
      ? {
          detailsAcceptance: {
            accepted: Boolean(source.detailsAcceptance.accepted),
            ...(typeof source.detailsAcceptance.acceptedRevision === 'number'
              ? { acceptedRevision: source.detailsAcceptance.acceptedRevision }
              : {}),
            ...(source.detailsAcceptance.acceptedAt
              ? { acceptedAt: source.detailsAcceptance.acceptedAt }
              : {}),
            profileRevision:
              typeof source.detailsAcceptance.profileRevision === 'number'
                ? source.detailsAcceptance.profileRevision
                : 0,
          },
        }
      : {}),
  };
}

export function mapHomeSection(source: VendorHomeSummarySource): VendorHomeSection {
  const today = source.today;
  const tomorrow = source.tomorrow;
  const upcoming = source.upcoming;
  if (!today?.visits || !today.crew || !today.completion || !Array.isArray(today.needsAttention)) {
    throw new BaseError(
      'Booking homeSummary omitted today.visits (or related today fields)',
      502,
      'DEPENDENCY_UNAVAILABLE',
      undefined,
      { retryable: true },
    );
  }
  if (!tomorrow?.date || !upcoming?.days || !Array.isArray(upcoming.days)) {
    throw new BaseError(
      'Booking homeSummary omitted tomorrow/upcoming day fields',
      502,
      'DEPENDENCY_UNAVAILABLE',
      undefined,
      { retryable: true },
    );
  }

  return {
    date: source.date,
    timezone: source.timezone,
    today: {
      visits: {
        total: today.visits.total,
        scheduled: today.visits.notStarted,
        completed: today.visits.completed,
        inProgress: today.visits.inProgress,
        notStarted: today.visits.notStarted,
        blocked: today.visits.blocked,
        missed: today.visits.missed,
        cancelled: today.visits.cancelled,
      },
      crew: {
        assigned: today.crew.assigned,
        unassigned: today.crew.unassigned,
      },
      needsAttention: today.needsAttention.map((item) => ({
        communityId: item.communityId,
        ...(item.communityName ? { communityName: item.communityName } : {}),
        visitWindowId: item.visitWindowId,
        ...(item.visitWindowName ? { visitWindowName: item.visitWindowName } : {}),
        visitCount: item.visitCount,
        blockedCount: item.blockedCount,
        unassignedCount: item.unassignedCount,
      })),
      completion: {
        completed: today.completion.completed,
        total: today.completion.total,
        percentage: today.completion.percentage,
      },
    },
    tomorrow: {
      date: tomorrow.date,
      totalVisits: tomorrow.totalVisits,
      assignedVisits: tomorrow.assignedVisits,
      unassignedVisits: tomorrow.unassignedVisits,
    },
    upcoming: {
      fromDate: upcoming.fromDate,
      toDate: upcoming.toDate,
      days: upcoming.days.map((day) => ({
        date: day.date,
        totalVisits: day.totalVisits,
        assignedVisits: day.assignedVisits,
        unassignedVisits: day.unassignedVisits,
        communities: (day.communities ?? []).map((community) => ({
          communityId: community.communityId,
          ...(community.communityName
            ? { communityName: community.communityName }
            : {}),
          visitCount: community.visitCount,
          unassignedCount: community.unassignedCount,
        })),
      })),
    },
  };
}

export function mapPendingProposals(
  items: readonly CapacityProposalSource[],
  now: Date,
): VendorHomePendingProposal[] {
  const mapped = items
    .filter(
      (item) =>
        item.status === VENDOR_HOME_PROPOSAL_STATUS.SENT ||
        item.status === VENDOR_HOME_PROPOSAL_STATUS.COUNTERED,
    )
    .map((item) => mapProposal(item, now));
  return mapped.sort((left, right) => {
    if (left.actionable !== right.actionable) {
      return Number(right.actionable) - Number(left.actionable);
    }
    return left.responseDeadline.localeCompare(right.responseDeadline);
  });
}

function mapProposal(
  item: CapacityProposalSource,
  now: Date,
): VendorHomePendingProposal {
  const deadlineMs = Date.parse(item.responseDeadline);
  const isPastDeadline = Number.isFinite(deadlineMs) ? deadlineMs < now.getTime() : false;
  const status =
    item.status === VENDOR_HOME_PROPOSAL_STATUS.COUNTERED
      ? VENDOR_HOME_PROPOSAL_STATUS.COUNTERED
      : VENDOR_HOME_PROPOSAL_STATUS.SENT;
  const actionable =
    !isPastDeadline &&
    (status === VENDOR_HOME_PROPOSAL_STATUS.SENT ||
      status === VENDOR_HOME_PROPOSAL_STATUS.COUNTERED);
  return {
    proposalId: item.proposalId,
    communityId: item.communityId,
    quantity: item.quantity,
    status,
    responseDeadline: item.responseDeadline,
    actionable,
    isPastDeadline,
    packageScope: asObject(item.packageScope),
    serviceWindow: asObject(item.serviceWindow),
    ...(item.counter ? { counter: asObject(item.counter) } : {}),
  };
}

export function mapCommitments(
  items: readonly CapacityCommitmentSource[],
): VendorHomeCommitment[] {
  return items
    .filter(
      (item) =>
        item.status === VENDOR_HOME_COMMITMENT_STATUS.ACTIVE ||
        item.status === VENDOR_HOME_COMMITMENT_STATUS.CHANGE_PENDING,
    )
    .map((item) => ({
      commitmentId: item.commitmentId,
      communityId: item.communityId,
      scope: asObject(item.scope),
      window: asObject(item.window),
      quantity: item.quantity,
      rate: asObject(item.rate ?? {}),
      status:
        item.status === VENDOR_HOME_COMMITMENT_STATUS.CHANGE_PENDING
          ? VENDOR_HOME_COMMITMENT_STATUS.CHANGE_PENDING
          : VENDOR_HOME_COMMITMENT_STATUS.ACTIVE,
      reservedSoldQuantity:
        typeof item.reservedSoldQuantity === 'number' ? item.reservedSoldQuantity : 0,
    }));
}

export function emptyCapacity(): VendorHomeCapacitySection {
  return { pendingProposals: [], commitments: [] };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
