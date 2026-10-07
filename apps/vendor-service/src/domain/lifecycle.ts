import { OnboardingStatus, VendorStatus } from '../types/api-types';

/**
 * Administrative lifecycle. Onboarding status is separate:
 * DRAFT / IN_PROGRESS → PENDING_REVIEW is owned by onboarding.
 * Approval moves PENDING_VERIFICATION → ACTIVE only after review.
 */
const ALLOWED_TRANSITIONS: Record<VendorStatus, readonly VendorStatus[]> = {
  PENDING_VERIFICATION: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['SUSPENDED', 'INACTIVE'],
  SUSPENDED: ['ACTIVE', 'INACTIVE'],
  INACTIVE: [],
  REJECTED: [],
};

const REVIEW_READY_ONBOARDING: ReadonlySet<OnboardingStatus> = new Set([
  'PENDING_REVIEW',
  'COMPLETED',
]);

export type StatusTransitionDecision =
  | { kind: 'idempotent' }
  | { kind: 'apply' }
  | { kind: 'invalid'; message: string };

export function decideVendorStatusTransition(input: {
  from: VendorStatus;
  to: VendorStatus;
  onboardingStatus: OnboardingStatus;
  reason?: string;
}): StatusTransitionDecision {
  if (input.from === input.to) {
    return { kind: 'idempotent' };
  }

  const allowed = ALLOWED_TRANSITIONS[input.from] ?? [];
  if (!allowed.includes(input.to)) {
    return {
      kind: 'invalid',
      message: `Cannot transition vendor status from ${input.from} to ${input.to}`,
    };
  }

  if (input.to === 'REJECTED' && !input.reason?.trim()) {
    return {
      kind: 'invalid',
      message: 'A reason is required to reject a vendor',
    };
  }

  if (
    input.from === 'PENDING_VERIFICATION' &&
    input.to === 'ACTIVE' &&
    !REVIEW_READY_ONBOARDING.has(input.onboardingStatus)
  ) {
    return {
      kind: 'invalid',
      message:
        'Vendor onboarding must be PENDING_REVIEW before the vendor can be approved',
    };
  }

  return { kind: 'apply' };
}

export function isVendorApproval(
  from: VendorStatus,
  to: VendorStatus,
): boolean {
  return from === 'PENDING_VERIFICATION' && to === 'ACTIVE';
}

export function isVendorRejection(to: VendorStatus): boolean {
  return to === 'REJECTED';
}

const ACCEPTING_WORK: ReadonlySet<string> = new Set(['ONLINE', 'BUSY']);

export function assertOperationalStatusAllowed(
  lifecycleStatus: VendorStatus,
  operationalStatus: string,
): StatusTransitionDecision {
  if (
    ACCEPTING_WORK.has(operationalStatus) &&
    lifecycleStatus !== 'ACTIVE'
  ) {
    return {
      kind: 'invalid',
      message: `Operational status ${operationalStatus} is only allowed when the vendor lifecycle status is ACTIVE`,
    };
  }
  return { kind: 'apply' };
}
