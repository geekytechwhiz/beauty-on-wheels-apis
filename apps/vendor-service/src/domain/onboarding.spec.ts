import {
  ONBOARDING_SECTION,
  ONBOARDING_STATUS,
  computeOnboardingState,
  isOwnerComplete,
} from './onboarding';

describe('computeOnboardingState', () => {
  it('returns DRAFT when no sections are complete', () => {
    const state = computeOnboardingState({
      hasBusinessInfo: false,
      hasOwner: false,
      hasAddress: false,
      hasBranch: false,
      documentTypes: [],
      hasBankDetails: false,
    });

    expect(state.status).toBe(ONBOARDING_STATUS.DRAFT);
    expect(state.currentSection).toBe(ONBOARDING_SECTION.BUSINESS_INFO_AND_OWNER);
    expect(state.completedSections).toEqual([]);
  });

  it('keeps business info and owner incomplete until both records exist', () => {
    const state = computeOnboardingState({
      hasBusinessInfo: true,
      hasOwner: false,
      hasAddress: false,
      hasBranch: false,
      documentTypes: [],
      hasBankDetails: false,
    });

    expect(state.status).toBe(ONBOARDING_STATUS.DRAFT);
    expect(state.completedSections).toEqual([]);
    expect(state.currentSection).toBe(ONBOARDING_SECTION.BUSINESS_INFO_AND_OWNER);
  });

  it('returns IN_PROGRESS and the next incomplete section', () => {
    const state = computeOnboardingState({
      hasBusinessInfo: true,
      hasOwner: true,
      hasAddress: true,
      hasBranch: false,
      documentTypes: [],
      hasBankDetails: false,
    });

    expect(state.status).toBe(ONBOARDING_STATUS.IN_PROGRESS);
    expect(state.currentSection).toBe(
      ONBOARDING_SECTION.SERVICE_LOCATION_AND_COVERAGE,
    );
    expect(state.completedSections).toEqual([
      ONBOARDING_SECTION.BUSINESS_INFO_AND_OWNER,
    ]);
  });

  it('requires all three document types before business verification is complete', () => {
    const incomplete = computeOnboardingState({
      hasBusinessInfo: true,
      hasOwner: true,
      hasAddress: true,
      hasBranch: true,
      documentTypes: ['GST_REGISTRATION', 'BUSINESS_REGISTRATION'],
      hasBankDetails: false,
    });

    expect(incomplete.completedSections).not.toContain(
      ONBOARDING_SECTION.BUSINESS_VERIFICATION,
    );
    expect(incomplete.currentSection).toBe(ONBOARDING_SECTION.BUSINESS_VERIFICATION);
  });

  it('returns PENDING_REVIEW only when every mandatory section is present', () => {
    const state = computeOnboardingState({
      hasBusinessInfo: true,
      hasOwner: true,
      hasAddress: true,
      hasBranch: true,
      documentTypes: [
        'GST_REGISTRATION',
        'BUSINESS_REGISTRATION',
        'COMMERCIAL_INSURANCE',
      ],
      hasBankDetails: true,
    });

    expect(state.status).toBe(ONBOARDING_STATUS.PENDING_REVIEW);
    expect(state.completedSections).toEqual([
      ONBOARDING_SECTION.BUSINESS_INFO_AND_OWNER,
      ONBOARDING_SECTION.SERVICE_LOCATION_AND_COVERAGE,
      ONBOARDING_SECTION.BUSINESS_VERIFICATION,
      ONBOARDING_SECTION.BANK_AND_PAYOUT_DETAILS,
    ]);
  });
});

describe('isOwnerComplete', () => {
  it('requires an identity userId and display name', () => {
    expect(isOwnerComplete({ userId: 'user-1' })).toBe(false);
    expect(isOwnerComplete({ userId: 'user-1', fullName: 'Priya Nair' })).toBe(
      true,
    );
  });
});
