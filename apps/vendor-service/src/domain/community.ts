import { CommunityCoverageApprovalStatus } from '../types/api-types';

export const MAX_VENDOR_COMMUNITIES = 25;

/**
 * Per-community coverage approval. Vendors can only ever create REQUESTED rows;
 * every other status is written by an admin through the coverage-approval route.
 */
export const COVERAGE_APPROVAL_STATUS = {
  REQUESTED: 'REQUESTED',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
} as const satisfies Record<CommunityCoverageApprovalStatus, CommunityCoverageApprovalStatus>;

/** Statuses an admin may set. REQUESTED and PENDING are intake states. */
export const COVERAGE_DECISION_STATUSES = [
  COVERAGE_APPROVAL_STATUS.APPROVED,
  COVERAGE_APPROVAL_STATUS.REJECTED,
  COVERAGE_APPROVAL_STATUS.SUSPENDED,
] as const;

export const COVERAGE_APPROVAL_LABELS: Record<CommunityCoverageApprovalStatus, string> = {
  REQUESTED: 'Requested',
  PENDING: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
};

/** Legacy rows have no approvalStatus. They read as PENDING and are never treated as approved. */
export function resolveCoverageApprovalStatus(
  item: { approvalStatus?: CommunityCoverageApprovalStatus },
): CommunityCoverageApprovalStatus {
  return item.approvalStatus ?? COVERAGE_APPROVAL_STATUS.PENDING;
}

export function isCoverageApproved(
  item: { approvalStatus?: CommunityCoverageApprovalStatus } | null | undefined,
): boolean {
  return Boolean(item) && item?.approvalStatus === COVERAGE_APPROVAL_STATUS.APPROVED;
}

const COMMUNITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function normalizeCommunityId(value: string): string {
  return value.trim();
}

export function isCommunityId(value: string): boolean {
  return COMMUNITY_ID_PATTERN.test(value);
}

export function uniqueCommunities(values: readonly {communityId: string, communityName: string}[]):
 {communityId: string, communityName: string}[] {
  const seen = new Set<string>();
  const communities = new Set<{communityId: string, communityName: string}>();
  for (const value of values) {
    const id = normalizeCommunityId(value.communityId);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id); 
    communities.add({communityId: id, communityName: value.communityName});
  }
  return Array.from(communities);
}
