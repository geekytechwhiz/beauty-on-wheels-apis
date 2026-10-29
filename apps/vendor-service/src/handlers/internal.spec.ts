import { getCheckoutEligibility, getPricingConfiguration } from './internal';

jest.mock('../services/checkout-eligibility.service', () => ({
  getCheckoutEligibilityService: () => ({
    get: jest.fn(async (vendorId: string, branchId?: string) => {
      if (branchId === 'missing') {
        const { BaseError } = jest.requireActual('@api-hub/utils');
        throw new BaseError('Branch does not belong to the selected vendor', 409, 'VENDOR_BRANCH_MISMATCH');
      }
      return {
        vendorId,
        status: 'ACTIVE',
        operationalStatus: 'ONLINE',
        onboardingStatus: 'COMPLETED',
        communityIds: ['community-1'],
        ...(branchId ? { branchId } : {}),
      };
    }),
  }),
}));

jest.mock('../services/pricing-configuration.service', () => ({
  getPricingConfigurationService: () => ({
    get: jest.fn(async (vendorId: string) => ({
      vendorId,
      configurationVersion: 1,
      services: [],
      packages: [],
    })),
  }),
}));

describe('vendor internal handlers', () => {
  it('reads eligibility without honoring an internal flag', async () => {
    const result = await getCheckoutEligibility({
      vendorId: 'vendor-1',
      branchId: 'branch-1',
      internal: true,
    } as { vendorId: string; branchId: string });

    expect(result).toEqual({
      data: expect.objectContaining({ vendorId: 'vendor-1', branchId: 'branch-1' }),
    });
  });

  it('reads vendor-only eligibility when branchId is omitted', async () => {
    const result = await getCheckoutEligibility({
      vendorId: 'vendor-1',
    });

    expect(result).toEqual({
      data: expect.objectContaining({ vendorId: 'vendor-1' }),
    });
    expect((result as { data: Record<string, unknown> }).data).not.toHaveProperty('branchId');
  });

  it('returns a branch ownership failure instead of an HTTP response', async () => {
    await expect(getCheckoutEligibility({
      vendorId: 'vendor-1',
      branchId: 'missing',
    })).resolves.toEqual({
      error: expect.objectContaining({ code: 'VENDOR_BRANCH_MISMATCH', statusCode: 409 }),
    });
  });

  it('requires a vendor id for pricing configuration', async () => {
    await expect(getPricingConfiguration({ vendorId: '  ' })).resolves.toEqual({
      error: expect.objectContaining({ code: 'VALIDATION_ERROR', statusCode: 400 }),
    });
  });
});
