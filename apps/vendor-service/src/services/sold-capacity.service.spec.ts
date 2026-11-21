import { BaseError } from '@api-hub/utils';

import { CapacityCommitmentDdbItem } from '../domain/capacity-commitment';
import { CapacityProposalsRepository } from '../repositories/capacity-proposals.repository';
import { SoldCapacityService } from './sold-capacity.service';

function commitment(
  overrides: Partial<CapacityCommitmentDdbItem> = {},
): CapacityCommitmentDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'CAPACITY_COMMITMENT#cmt_1',
    commitmentId: 'cmt_1',
    proposalId: 'cpr_1',
    vendorId: 'vendor-1',
    communityId: 'com-1',
    scope: { offeringId: 'pkg_car_wash', label: 'Car wash' },
    window: {
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      dailyWindow: { startTime: '09:00', endTime: '13:00' },
    },
    quantity: 10,
    rate: { amountMinor: 1000, currency: 'INR' },
    status: 'ACTIVE',
    reservedSoldQuantity: 0,
    createdBy: 'admin-1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    entityType: 'CapacityCommitment',
    ...overrides,
  };
}

describe('SoldCapacityService offeringId matching', () => {
  let repository: jest.Mocked<CapacityProposalsRepository>;
  let service: SoldCapacityService;

  beforeEach(() => {
    repository = {
      getSoldCapacityReservation: jest.fn().mockResolvedValue(null),
      listCommitments: jest.fn().mockResolvedValue([]),
      reserveSoldCapacity: jest.fn().mockResolvedValue(undefined),
      getCommitment: jest.fn(),
      releaseSoldCapacity: jest.fn(),
      confirmCapacityHold: jest.fn(),
    } as unknown as jest.Mocked<CapacityProposalsRepository>;
    service = new SoldCapacityService(repository);
  });

  it('reserves against a commitment whose offeringId matches', async () => {
    const match = commitment({ commitmentId: 'cmt_match', quantity: 8 });
    repository.listCommitments.mockResolvedValue([match]);
    repository.getCommitment.mockResolvedValue({
      ...match,
      reservedSoldQuantity: 2,
    });

    const result = await service.holdPlanCapacity({
      vendorId: 'vendor-1',
      communityId: 'com-1',
      offeringId: 'pkg_car_wash',
      demandQuantity: 2,
      planId: 'plan_1',
      expiresAt: '2026-11-01T01:00:00.000Z',
    });

    expect(repository.reserveSoldCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ commitmentId: 'cmt_match', quantity: 2 }),
    );
    expect(result.commitmentId).toBe('cmt_match');
  });

  it('does not fall back to serviceScopeCode-only or other-offering commitments', async () => {
    repository.listCommitments.mockResolvedValue([
      commitment({
        commitmentId: 'cmt_legacy',
        scope: { serviceScopeCode: 'service:CAR_WASH', label: 'Car wash' },
      }),
      commitment({
        commitmentId: 'cmt_other',
        scope: { offeringId: 'pkg_other', label: 'Other' },
      }),
    ]);

    await expect(
      service.holdPlanCapacity({
        vendorId: 'vendor-1',
        communityId: 'com-1',
        offeringId: 'pkg_car_wash',
        demandQuantity: 1,
        planId: 'plan_2',
        expiresAt: '2026-11-01T01:00:00.000Z',
      }),
    ).rejects.toThrow(BaseError);
    expect(repository.reserveSoldCapacity).not.toHaveBeenCalled();
  });

  it('rejects when remaining visit-slots are below plan demand', async () => {
    repository.listCommitments.mockResolvedValue([
      commitment({ commitmentId: 'cmt_small', quantity: 2, reservedSoldQuantity: 0 }),
    ]);

    await expect(
      service.holdPlanCapacity({
        vendorId: 'vendor-1',
        communityId: 'com-1',
        offeringId: 'pkg_car_wash',
        demandQuantity: 4,
        planId: 'plan_3',
        expiresAt: '2026-11-01T01:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    expect(repository.reserveSoldCapacity).not.toHaveBeenCalled();
  });

  it('passes commitmentQuantity from the selected commitment into reserveSoldCapacity', async () => {
    const match = commitment({ commitmentId: 'cmt_match', quantity: 8 });
    repository.listCommitments.mockResolvedValue([match]);
    repository.getCommitment.mockResolvedValue({
      ...match,
      reservedSoldQuantity: 2,
    });

    await service.holdPlanCapacity({
      vendorId: 'vendor-1',
      communityId: 'com-1',
      offeringId: 'pkg_car_wash',
      demandQuantity: 2,
      planId: 'plan_4',
      expiresAt: '2026-11-01T01:00:00.000Z',
    });

    expect(repository.reserveSoldCapacity).toHaveBeenCalledWith(
      expect.objectContaining({
        commitmentId: 'cmt_match',
        quantity: 2,
        commitmentQuantity: 8,
      }),
    );
  });
});
