import { OnboardingSection, OnboardingStatus, VendorStatus } from '../types/api-types';
import { ONBOARDING_STATUS } from './onboarding';

export const VENDOR_NEXT_ACTION = {
  START_ONBOARDING: 'START_ONBOARDING',
  RESUME_ONBOARDING: 'RESUME_ONBOARDING',
  VIEW_APPLICATION_STATUS: 'VIEW_APPLICATION_STATUS',
  OPEN_VENDOR_DASHBOARD: 'OPEN_VENDOR_DASHBOARD',
  COMPLETE_VENDOR_SETUP: 'COMPLETE_VENDOR_SETUP',
  VIEW_ACCOUNT_STATUS: 'VIEW_ACCOUNT_STATUS',
  CORRECT_APPLICATION: 'CORRECT_APPLICATION',
} as const;

export type VendorNextAction =
  (typeof VENDOR_NEXT_ACTION)[keyof typeof VENDOR_NEXT_ACTION];

const REVIEW_READY = new Set<OnboardingStatus>([
  ONBOARDING_STATUS.PENDING_REVIEW,
  ONBOARDING_STATUS.COMPLETED,
]);

export interface VendorSelfSource {
  vendorId: string;
  status: VendorStatus;
  onboardingStatus: OnboardingStatus;
  currentSection: OnboardingSection;
}

/**
 * An approved vendor can open the dashboard once onboarding has reached the
 * same review-ready states required before approval.
 */
export function isOperationallyEligible(
  vendor: Pick<VendorSelfSource, 'status' | 'onboardingStatus'>,
): boolean {
  return vendor.status === 'ACTIVE' && REVIEW_READY.has(vendor.onboardingStatus);
}

export function isOnboardingComplete(status: OnboardingStatus): boolean {
  return REVIEW_READY.has(status);
}

export function resolveVendorNextAction(
  vendor: Pick<VendorSelfSource, 'status' | 'onboardingStatus'> | null,
): VendorNextAction {
  if (!vendor) {
    return VENDOR_NEXT_ACTION.START_ONBOARDING;
  }

  if (vendor.status === 'REJECTED') {
    return VENDOR_NEXT_ACTION.CORRECT_APPLICATION;
  }

  if (vendor.status === 'SUSPENDED' || vendor.status === 'INACTIVE') {
    return VENDOR_NEXT_ACTION.VIEW_ACCOUNT_STATUS;
  }

  if (vendor.status === 'ACTIVE') {
    return isOperationallyEligible(vendor)
      ? VENDOR_NEXT_ACTION.OPEN_VENDOR_DASHBOARD
      : VENDOR_NEXT_ACTION.COMPLETE_VENDOR_SETUP;
  }

  if (REVIEW_READY.has(vendor.onboardingStatus)) {
    return VENDOR_NEXT_ACTION.VIEW_APPLICATION_STATUS;
  }

  return VENDOR_NEXT_ACTION.RESUME_ONBOARDING;
}

/**
 * Surface onboarding progress while the application is still pending, and the
 * lifecycle status once the account has been approved or closed.
 */
export function resolveVendorSelfStatus(
  vendor: Pick<VendorSelfSource, 'status' | 'onboardingStatus'>,
): VendorStatus | OnboardingStatus {
  if (vendor.status !== 'PENDING_VERIFICATION') {
    return vendor.status;
  }
  if (vendor.onboardingStatus === ONBOARDING_STATUS.COMPLETED) {
    return ONBOARDING_STATUS.PENDING_REVIEW;
  }
  return vendor.onboardingStatus;
}
