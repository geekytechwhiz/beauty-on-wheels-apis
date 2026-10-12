import { mapVendorFailure, parseCheckoutEligibility } from './vendor.client';

describe('vendor eligibility client', () => {
  it('reads only the eligibility fields from an internal invoke', () => {
    const result = parseCheckoutEligibility({
      data: {
        vendorId: 'vendor-1',
        status: 'ACTIVE',
        operationalStatus: 'ONLINE',
        onboardingStatus: 'COMPLETED',
        communityIds: ['community-1'],
        branchId: 'branch-1',
        businessName: 'Glow',
        internal: true,
      },
    }, 'vendor-1', 'branch-1');

    expect(result).toEqual({
      vendor: {
        vendorId: 'vendor-1',
        status: 'ACTIVE',
        operationalStatus: 'ONLINE',
        onboardingStatus: 'COMPLETED',
        communityIds: ['community-1'],
      },
      branch: { branchId: 'branch-1', vendorId: 'vendor-1' },
    });
  });

  it('maps branch ownership and vendor lookup failures', () => {
    expect(mapVendorFailure({ code: 'VENDOR_BRANCH_MISMATCH', statusCode: 409 }).code)
      .toBe('VENDOR_BRANCH_MISMATCH');
    expect(mapVendorFailure({ code: 'VENDOR_NOT_FOUND', statusCode: 404 }).statusCode).toBe(404);
    expect(mapVendorFailure({ code: 'INTERNAL_ERROR', statusCode: 500 }).code)
      .toBe('DEPENDENCY_UNAVAILABLE');
  });
});
