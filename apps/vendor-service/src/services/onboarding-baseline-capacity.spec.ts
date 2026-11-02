import { LambdaRequest } from '@api-hub/utils';

import { OnboardingService } from './onboarding.service';
import { CommunitiesRepository } from '../repositories/communities.repository';
import { VendorsRepository } from '../repositories/vendors.repository';
import { VendorBaselineCapacityDdbItem, VendorDdbItem } from '../types/repository.types';

function authRequest(body: unknown): LambdaRequest {
  return {
    params: { vendorId: 'vendor-1' },
    body,
    context: { userContext: { userId: 'user-1' } },
  } as unknown as LambdaRequest;
}

function vendorItem(): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'PROFILE',
    vendorId: 'vendor-1',
    ownerUserId: 'user-1',
    businessType: 'BUSINESS',
    status: 'PENDING_VERIFICATION',
    operationalStatus: 'OFFLINE',
    onboardingStatus: 'IN_PROGRESS',
    currentSection: 'COMMUNITIES',
    completedSections: ['BUSINESS_INFO', 'COMMUNITIES'],
    communityIds: ['comm-a'],
    revision: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    GSI1PK: 'VENDOR',
    GSI1SK: 'STATUS#PENDING_VERIFICATION#OPERATIONAL#OFFLINE#2026-01-01T00:00:00.000Z#vendor-1',
    entityType: 'Vendor',
  };
}

describe('OnboardingService baseline capacity', () => {
  let vendorsRepository: jest.Mocked<VendorsRepository>;
  let communitiesRepository: jest.Mocked<CommunitiesRepository>;
  let service: OnboardingService;

  beforeEach(() => {
    vendorsRepository = {
      getVendorById: jest.fn().mockResolvedValue(vendorItem()),
      queryVendorItems: jest.fn().mockResolvedValue([vendorItem()]),
      transactVendorProfile: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VendorsRepository>;
    communitiesRepository = {
      listByVendor: jest.fn().mockResolvedValue([]),
      getActiveCommunity: jest.fn(),
    } as unknown as jest.Mocked<CommunitiesRepository>;
    service = new OnboardingService(vendorsRepository, communitiesRepository);
  });

  it('persists optional baseline capacity estimates without touching capacity APIs', async () => {
    const response = await service.updatevendoronboarding(authRequest({
      revision: 2,
      sections: {
        BASELINE_CAPACITY: {
          communities: [{
            communityId: 'comm-a',
            estimatedCrews: 2,
            estimatedVisitsPerDay: 12,
            serviceWindowNotes: 'Weekday mornings',
          }],
        },
      },
    }));

    expect(response.sections.BASELINE_CAPACITY).toEqual([{
      communityId: 'comm-a',
      estimatedCrews: 2,
      estimatedVisitsPerDay: 12,
      serviceWindowNotes: 'Weekday mornings',
    }]);
    expect(vendorsRepository.transactVendorProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        puts: expect.arrayContaining([
          expect.objectContaining({
            item: expect.objectContaining({
              entityType: 'VendorBaselineCapacity',
              communityId: 'comm-a',
            }),
          }),
        ]),
      }),
    );
    expect(communitiesRepository.getActiveCommunity).not.toHaveBeenCalled();
  });

  it('returns saved baseline capacity on GET onboarding', async () => {
    const baseline: VendorBaselineCapacityDdbItem = {
      PK: 'VENDOR#vendor-1',
      SK: 'BASELINE_CAPACITY#comm-a',
      vendorId: 'vendor-1',
      communityId: 'comm-a',
      estimatedCrews: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      entityType: 'VendorBaselineCapacity',
    };
    vendorsRepository.queryVendorItems.mockResolvedValue([vendorItem(), baseline]);

    const response = await service.getvendoronboarding(authRequest({}));

    expect(response.sections.BASELINE_CAPACITY).toEqual([{
      communityId: 'comm-a',
      estimatedCrews: 1,
    }]);
  });
});
