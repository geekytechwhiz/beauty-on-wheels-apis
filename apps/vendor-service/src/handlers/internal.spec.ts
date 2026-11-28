import { getCheckoutEligibility, getPricingConfiguration, partnerManagerRead } from './internal';

const mockResolveOperationalAccess = jest.fn();
const mockGetMyVendor = jest.fn();
const mockListSchedulingCrews = jest.fn();
const mockListCommitments = jest.fn();
const mockListProposals = jest.fn();

jest.mock('../services/vendors.service', () => ({
  getVendorsService: () => ({
    resolveOperationalAccess: mockResolveOperationalAccess,
    getMyVendor: mockGetMyVendor,
  }),
}));

jest.mock('../services/scheduling-crews.service', () => ({
  getSchedulingCrewsService: () => ({ list: mockListSchedulingCrews }),
}));

jest.mock('../services/capacity-proposals.service', () => ({
  getCapacityProposalsService: () => ({
    listvendorcapacitycommitments: mockListCommitments,
    listvendorcapacityproposals: mockListProposals,
  }),
}));

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

  describe('partnerManagerRead', () => {
    const actor = { userId: 'owner-1', vendorId: 'vendor-1', roles: ['manager'], permissions: [], correlationId: 'c-1' };
    const crew = {
      crewId: 'crew-1', vendorId: 'vendor-1', name: 'Crew One', vanLabel: 'Van 1', status: 'ACTIVE',
      availabilityStatus: 'AVAILABLE', capacityPerDay: 4, staff: [],
      pointOfContact: { staffId: 'staff-1', name: 'Asha', phoneNumber: '+919800000000', source: 'firstActiveMember' },
    };

    beforeEach(() => {
      mockResolveOperationalAccess.mockReset().mockResolvedValue({ role: 'owner', vendorId: 'vendor-1', active: true });
      mockGetMyVendor.mockReset().mockResolvedValue({
        hasVendor: true,
        vendorId: 'vendor-1',
        status: 'ACTIVE',
        nextAction: 'OPEN_VENDOR_DASHBOARD',
        membership: { role: 'owner', permissions: ['visits:view'] },
      });
      mockListSchedulingCrews.mockReset().mockResolvedValue({ crews: [crew] });
      mockListCommitments.mockReset().mockResolvedValue({ data: { items: [{ commitmentId: 'commitment-1' }] } });
      mockListProposals.mockReset().mockResolvedValue({ data: { items: [{ proposalId: 'cpr_1', status: 'SENT' }] } });
    });

    it('returns crews with their point of contact for the verified owner', async () => {
      const result = await partnerManagerRead({ actor, includeCrews: true }) as { data: Record<string, unknown> };
      expect(mockResolveOperationalAccess).toHaveBeenCalledWith('owner-1');
      expect(mockListSchedulingCrews).toHaveBeenCalledWith('vendor-1', { includePointOfContact: true });
      expect(result.data).toMatchObject({ crews: [crew], sourceAsOf: expect.any(String) });
      expect(result.data).not.toHaveProperty('unavailableSections');
    });

    it('keeps crews when the optional commitments read fails', async () => {
      mockListCommitments.mockRejectedValue(new Error('commitments down'));
      const result = await partnerManagerRead({ actor, includeCrews: true, includeCommitments: true }) as { data: Record<string, unknown> };
      expect(result.data).toMatchObject({ crews: [crew], unavailableSections: ['commitments'] });
      expect(result.data).not.toHaveProperty('commitments');
    });

    it('rejects an actor whose canonical membership is for another vendor or is not an owner for crews', async () => {
      mockResolveOperationalAccess.mockResolvedValue({ role: 'owner', vendorId: 'vendor-2', active: true });
      await expect(partnerManagerRead({ actor, includeCrews: true })).resolves.toEqual({ error: expect.objectContaining({ statusCode: 403 }) });
      mockResolveOperationalAccess.mockResolvedValue({ role: 'staff', vendorId: 'vendor-1', staffId: 'staff-1', active: true });
      await expect(partnerManagerRead({ actor, includeCrews: true })).resolves.toEqual({ error: expect.objectContaining({ statusCode: 403 }) });
      expect(mockListSchedulingCrews).not.toHaveBeenCalled();
    });

    it('allows active staff to read vendor context without crews', async () => {
      mockResolveOperationalAccess.mockResolvedValue({
        role: 'staff',
        vendorId: 'vendor-1',
        staffId: 'staff-1',
        active: true,
      });
      mockGetMyVendor.mockResolvedValue({
        hasVendor: true,
        vendorId: 'vendor-1',
        status: 'ACTIVE',
        nextAction: 'OPEN_VENDOR_DASHBOARD',
        membership: { role: 'staff', staffId: 'staff-1', permissions: ['visits:view'] },
      });
      const result = await partnerManagerRead({
        actor: { ...actor, userId: 'staff-1', roles: ['buddy'], permissions: ['visits:view'] },
        includeVendorContext: true,
      }) as { data: Record<string, unknown> };
      expect(result.data.vendorContext).toMatchObject({
        vendorId: 'vendor-1',
        membership: { role: 'staff' },
      });
      expect(mockListSchedulingCrews).not.toHaveBeenCalled();
    });

    it('surfaces a crew read failure so the BFF can mark crews unavailable', async () => {
      const { BaseError } = jest.requireActual('@api-hub/utils');
      mockListSchedulingCrews.mockRejectedValue(new BaseError('Vendor table unavailable', 503, 'DEPENDENCY_UNAVAILABLE'));
      await expect(partnerManagerRead({ actor, includeCrews: true })).resolves.toEqual({
        error: expect.objectContaining({ code: 'DEPENDENCY_UNAVAILABLE', statusCode: 503 }),
      });
    });
  });
});
