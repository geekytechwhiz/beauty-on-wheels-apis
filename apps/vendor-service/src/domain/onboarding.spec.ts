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
    expect(state.currentSection).toBe(ONBOARDING_SECTION.BUSINESS_INFO);
    expect(state.completedSections).toEqual([]);
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
    expect(state.currentSection).toBe(ONBOARDING_SECTION.BRANCH);
    expect(state.completedSections).toEqual([
      ONBOARDING_SECTION.BUSINESS_INFO,
      ONBOARDING_SECTION.OWNER_DETAILS,
      ONBOARDING_SECTION.ADDRESS,
    ]);
  });

  it('requires all three document types before DOCUMENTS is complete', () => {
    const incomplete = computeOnboardingState({
      hasBusinessInfo: true,
      hasOwner: true,
      hasAddress: true,
      hasBranch: true,
      documentTypes: ['GST_REGISTRATION', 'BUSINESS_REGISTRATION'],
      hasBankDetails: false,
    });

    expect(incomplete.completedSections).not.toContain(
      ONBOARDING_SECTION.DOCUMENTS,
    );
    expect(incomplete.currentSection).toBe(ONBOARDING_SECTION.DOCUMENTS);
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
    expect(state.completedSections).toHaveLength(6);
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
