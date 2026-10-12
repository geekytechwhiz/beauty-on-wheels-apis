import { LambdaRequest } from '@api-hub/utils';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@api-hub/utils';

import { BranchesService } from './branches.service';
import { BranchesRepository } from '../repositories/branches.repository';
import { VendorsRepository } from '../repositories/vendors.repository';
import { VendorBranchDdbItem, VendorDdbItem } from '../types/repository.types';

function request(overrides: Record<string, unknown> = {}): LambdaRequest {
  return {
    pathParameters: { vendorId: 'vendor-1' },
    params: { vendorId: 'vendor-1' },
    context: {
      userContext: { userId: 'user-1' },
    },
    ...overrides,
  } as unknown as LambdaRequest;
}

function vendor(overrides: Partial<VendorDdbItem> = {}): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'PROFILE',
    vendorId: 'vendor-1',
    ownerUserId: 'user-1',
    status: 'ACTIVE',
    operationalStatus: 'ONLINE',
    onboardingStatus: 'PENDING_REVIEW',
    currentSection: 'BRANCH',
    completedSections: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    GSI1PK: 'VENDOR',
    GSI1SK: 'STATUS#ACTIVE',
    entityType: 'Vendor',
    ...overrides,
  };
}

function branch(overrides: Partial<VendorBranchDdbItem> = {}): VendorBranchDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'BRANCH#branch-1',
    branchId: 'branch-1',
    vendorId: 'vendor-1',
    name: 'Koramangala',
    isPrimary: true,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    entityType: 'VendorBranch',
    ...overrides,
  };
}

describe('BranchesService.listvendorbranches', () => {
  let branches: jest.Mocked<Pick<BranchesRepository, 'listBranches'>>;
  let vendors: jest.Mocked<Pick<VendorsRepository, 'getVendorById'>>;
  let service: BranchesService;

  beforeEach(() => {
    branches = {
      listBranches: jest.fn().mockResolvedValue([branch()]),
    };
    vendors = {
      getVendorById: jest.fn().mockResolvedValue(vendor()),
    };
    service = new BranchesService(
      branches as unknown as BranchesRepository,
      vendors as unknown as VendorsRepository,
    );
  });

  it('returns the owner permitted branches without persistence keys', async () => {
    const result = await service.listvendorbranches(request());

    expect(branches.listBranches).toHaveBeenCalledWith('vendor-1');
    expect(result).toEqual({
      data: [
        {
          branchId: 'branch-1',
          vendorId: 'vendor-1',
          name: 'Koramangala',
          phoneNumber: undefined,
          email: undefined,
          address: undefined,
          geoLocation: undefined,
          isPrimary: true,
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    expect(result.data[0]).not.toHaveProperty('PK');
    expect(result.data[0]).not.toHaveProperty('SK');
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(
      service.listvendorbranches(
        request({
          context: { userContext: {} },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(branches.listBranches).not.toHaveBeenCalled();
  });

  it('rejects a caller who does not own the vendor', async () => {
    await expect(
      service.listvendorbranches(
        request({
          context: { userContext: { userId: 'other-user' } },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(branches.listBranches).not.toHaveBeenCalled();
  });

  it('allows an administrator to list another vendor branches', async () => {
    const result = await service.listvendorbranches(
      request({
        context: { userContext: { userId: 'admin-1', roles: ['ADMIN'] } },
      }),
    );

    expect(result.data).toHaveLength(1);
  });

  it('rejects a missing vendor id', async () => {
    await expect(
      service.listvendorbranches(
        request({
          pathParameters: {},
          params: {},
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns not found when the vendor does not exist', async () => {
    vendors.getVendorById.mockResolvedValue(null);

    await expect(service.listvendorbranches(request())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(branches.listBranches).not.toHaveBeenCalled();
  });
});
