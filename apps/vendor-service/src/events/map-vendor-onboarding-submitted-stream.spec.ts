import {
  isVendorOnboardingSubmittedTransition,
  toVendorOnboardingSubmittedPayload,
} from './map-vendor-onboarding-submitted-stream';

describe('isVendorOnboardingSubmittedTransition', () => {
  it('is true only for Vendor profile IN_PROGRESS → PENDING_REVIEW', () => {
    expect(
      isVendorOnboardingSubmittedTransition(
        { entityType: 'Vendor', onboardingStatus: 'IN_PROGRESS' },
        {
          entityType: 'Vendor',
          onboardingStatus: 'PENDING_REVIEW',
        },
      ),
    ).toBe(true);
  });

  it('is false for DRAFT → IN_PROGRESS', () => {
    expect(
      isVendorOnboardingSubmittedTransition(
        { entityType: 'Vendor', onboardingStatus: 'DRAFT' },
        { entityType: 'Vendor', onboardingStatus: 'IN_PROGRESS' },
      ),
    ).toBe(false);
  });

  it('is false for PENDING_REVIEW → PENDING_REVIEW', () => {
    expect(
      isVendorOnboardingSubmittedTransition(
        { entityType: 'Vendor', onboardingStatus: 'PENDING_REVIEW' },
        { entityType: 'Vendor', onboardingStatus: 'PENDING_REVIEW' },
      ),
    ).toBe(false);
  });

  it('is false for child entity updates', () => {
    expect(
      isVendorOnboardingSubmittedTransition(
        { entityType: 'VendorDocument' },
        { entityType: 'VendorDocument' },
      ),
    ).toBe(false);
  });
});

describe('toVendorOnboardingSubmittedPayload', () => {
  it('maps identifiers without extra vendor PII', () => {
    expect(
      toVendorOnboardingSubmittedPayload({
        applicationId: 'app-1',
        vendorId: 'vendor-1',
        ownerUserId: 'user-1',
        email: 'owner@example.com',
        onboardingStatus: 'PENDING_REVIEW',
        businessName: 'ABC Car Wash',
        phoneNumber: '+919876543210',
        gstNumber: 'GST',
      }),
    ).toEqual({
      applicationId: 'app-1',
      vendorId: 'vendor-1',
      ownerUserId: 'user-1',
      email: 'owner@example.com',
      onboardingStatus: 'PENDING_REVIEW',
      businessName: 'ABC Car Wash',
    });
  });
});
