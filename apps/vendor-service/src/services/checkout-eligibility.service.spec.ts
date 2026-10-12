import { BranchesRepository } from '../repositories/branches.repository';
import { VendorsRepository } from '../repositories/vendors.repository';
import { VendorBranchDdbItem, VendorDdbItem } from '../types/repository.types';
import { CheckoutEligibilityService } from './checkout-eligibility.service';

function vendor(): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'PROFILE',
    vendorId: 'vendor-1',
    ownerUserId: 'owner-1',
    businessName: 'Glow',
    email: 'owner@example.com',
    phoneNumber: '+919800000000',
    status: 'ACTIVE',
    operationalStatus: 'ONLINE',
    onboardingStatus: 'COMPLETED',
    currentSection: 'BRANCH',
    completedSections: [],
    communityIds: ['community-1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    GSI1PK: 'VENDOR',
    GSI1SK: 'STATUS#ACTIVE',
    entityType: 'Vendor',
  };
}

function branch(): VendorBranchDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'BRANCH#branch-1',
    branchId: 'branch-1',
    vendorId: 'vendor-1',
    name: 'Indiranagar',
    isPrimary: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entityType: 'VendorBranch',
  };
}

describe('CheckoutEligibilityService', () => {
  const vendors = { getVendorById: jest.fn() };
  const branches = { getBranch: jest.fn() };
  const service = new CheckoutEligibilityService(
    vendors as unknown as VendorsRepository,
    branches as unknown as BranchesRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns only eligibility fields for a branch owned by the vendor', async () => {
    vendors.getVendorById.mockResolvedValue(vendor());
    branches.getBranch.mockResolvedValue(branch());

    const result = await service.get('vendor-1', 'branch-1');

    expect(result).toEqual({
      vendorId: 'vendor-1',
      status: 'ACTIVE',
      operationalStatus: 'ONLINE',
      onboardingStatus: 'COMPLETED',
      communityIds: ['community-1'],
      branchId: 'branch-1',
    });
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('businessName');
  });

  it('rejects an unknown vendor and a branch that is not under that vendor', async () => {
    vendors.getVendorById.mockResolvedValue(null);
    await expect(service.get('missing', 'branch-1')).rejects.toMatchObject({
      code: 'VENDOR_NOT_FOUND',
      statusCode: 404,
    });

    vendors.getVendorById.mockResolvedValue(vendor());
    branches.getBranch.mockResolvedValue(null);
    await expect(service.get('vendor-1', 'other-branch')).rejects.toMatchObject({
      code: 'VENDOR_BRANCH_MISMATCH',
      statusCode: 409,
    });
    expect(branches.getBranch).toHaveBeenCalledWith('vendor-1', 'other-branch');
  });
});
