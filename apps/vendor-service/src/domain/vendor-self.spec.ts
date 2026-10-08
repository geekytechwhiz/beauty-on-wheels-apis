import {
  resolveVendorNextAction,
  resolveVendorSelfStatus,
} from './vendor-self';

describe('vendor self navigation', () => {
  it('maps each lifecycle to one next action', () => {
    expect(resolveVendorNextAction(null)).toBe('START_ONBOARDING');
    expect(
      resolveVendorNextAction({
        status: 'PENDING_VERIFICATION',
        onboardingStatus: 'DRAFT',
      }),
    ).toBe('RESUME_ONBOARDING');
    expect(
      resolveVendorNextAction({
        status: 'PENDING_VERIFICATION',
        onboardingStatus: 'IN_PROGRESS',
      }),
    ).toBe('RESUME_ONBOARDING');
    expect(
      resolveVendorNextAction({
        status: 'PENDING_VERIFICATION',
        onboardingStatus: 'PENDING_REVIEW',
      }),
    ).toBe('VIEW_APPLICATION_STATUS');
    expect(
      resolveVendorNextAction({
        status: 'ACTIVE',
        onboardingStatus: 'PENDING_REVIEW',
      }),
    ).toBe('OPEN_VENDOR_DASHBOARD');
    expect(
      resolveVendorNextAction({
        status: 'ACTIVE',
        onboardingStatus: 'DRAFT',
      }),
    ).toBe('COMPLETE_VENDOR_SETUP');
    expect(
      resolveVendorNextAction({
        status: 'REJECTED',
        onboardingStatus: 'PENDING_REVIEW',
      }),
    ).toBe('CORRECT_APPLICATION');
    expect(
      resolveVendorNextAction({
        status: 'SUSPENDED',
        onboardingStatus: 'COMPLETED',
      }),
    ).toBe('VIEW_ACCOUNT_STATUS');
    expect(
      resolveVendorNextAction({
        status: 'INACTIVE',
        onboardingStatus: 'COMPLETED',
      }),
    ).toBe('VIEW_ACCOUNT_STATUS');
  });

  it('reports onboarding status while verification is pending', () => {
    expect(
      resolveVendorSelfStatus({
        status: 'PENDING_VERIFICATION',
        onboardingStatus: 'DRAFT',
      }),
    ).toBe('DRAFT');
    expect(
      resolveVendorSelfStatus({
        status: 'ACTIVE',
        onboardingStatus: 'PENDING_REVIEW',
      }),
    ).toBe('ACTIVE');
  });
});
