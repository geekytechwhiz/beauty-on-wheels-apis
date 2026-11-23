import { BaseError } from '@api-hub/utils';

import { CapacityCommitmentDdbItem } from '../domain/capacity-commitment';
import { CapacityProposalsRepository } from '../repositories/capacity-proposals.repository';
import { SoldCapacityService } from './sold-capacity.service';

/** Single-day window so periodSupply === daily quantity (easy to reason about in tests). */
function oneDayWindow(date = '2026-11-01') {
  return {
    startDate: date,
    endDate: date,
    dailyWindow: { startTime: '09:00', endTime: '13:00' },
  };
}

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
    window: oneDayWindow(),
    quantity: 10,
    rate: { amountMinor: 1000, currency: 'INR' },
    status: 'ACTIVE',
    reservedSoldQuantity: 0,
    claimedPeriodQuantity: 0,
    createdBy: 'admin-1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    entityType: 'CapacityCommitment',
    ...overrides,
  };
}

describe('SoldCapacityService', () => {
  let repository: jest.Mocked<CapacityProposalsRepository>;
  let service: SoldCapacityService;

  beforeEach(() => {
    repository = {
      getSoldCapacityReservation: jest.fn().mockResolvedValue(null),
      listCommitments: jest.fn().mockResolvedValue([]),
      reserveSoldCapacity: jest.fn().mockResolvedValue(undefined),
      getCommitment: jest.fn(),
      releaseSoldCapacity: jest.fn().mockResolvedValue(undefined),
      confirmCapacityHold: jest.fn(),
      getVisitSoldCapacityReservation: jest.fn().mockResolvedValue(null),
      getCommitmentDaySold: jest.fn().mockResolvedValue(null),
      reserveVisitSoldCapacity: jest.fn().mockResolvedValue(undefined),
      releaseVisitSoldCapacity: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CapacityProposalsRepository>;
    service = new SoldCapacityService(repository);
  });

  describe('period eligibility (payment hold / confirm)', () => {
    it('A: fails when vendor has no accepted commitment', async () => {
      repository.listCommitments.mockResolvedValue([]);

      await expect(
        service.holdPlanCapacity({
          vendorId: 'vendor-1',
          communityId: 'com-1',
          offeringId: 'pkg_car_wash',
          demandQuantity: 1,
          planId: 'plan_a',
          expiresAt: '2026-11-01T01:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
      expect(repository.reserveSoldCapacity).not.toHaveBeenCalled();
    });

    it('B: fails when only cancelled (non-holding) commitments exist', async () => {
      repository.listCommitments.mockResolvedValue([
        commitment({ commitmentId: 'cmt_cancelled', status: 'CANCELLED', quantity: 100 }),
      ]);

      await expect(
        service.holdPlanCapacity({
          vendorId: 'vendor-1',
          communityId: 'com-1',
          offeringId: 'pkg_car_wash',
          demandQuantity: 1,
          planId: 'plan_b',
          expiresAt: '2026-11-01T01:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    });

    it('C: succeeds when period supply exactly equals plan period demand', async () => {
      // 1 service day × quantity 5 = periodSupply 5
      const match = commitment({ commitmentId: 'cmt_exact', quantity: 5 });
      repository.listCommitments.mockResolvedValue([match]);
      repository.getCommitment.mockResolvedValue({
        ...match,
        claimedPeriodQuantity: 5,
      });

      const result = await service.holdPlanCapacity({
        vendorId: 'vendor-1',
        communityId: 'com-1',
        offeringId: 'pkg_car_wash',
        demandQuantity: 5,
        planId: 'plan_c',
        expiresAt: '2026-11-01T01:00:00.000Z',
      });

      expect(repository.reserveSoldCapacity).toHaveBeenCalledWith(
        expect.objectContaining({
          commitmentId: 'cmt_exact',
          quantity: 5,
          commitmentQuantity: 5,
          periodSupply: 5,
          consumesDailySlots: false,
        }),
      );
      expect(result.commitmentId).toBe('cmt_exact');
      expect(result.periodSupply).toBe(5);
    });

    it('D: fails when period supply is one slot below plan demand', async () => {
      // 1 day × 4 = 4 < demand 5
      repository.listCommitments.mockResolvedValue([
        commitment({ commitmentId: 'cmt_short', quantity: 4 }),
      ]);

      await expect(
        service.holdPlanCapacity({
          vendorId: 'vendor-1',
          communityId: 'com-1',
          offeringId: 'pkg_car_wash',
          demandQuantity: 5,
          planId: 'plan_d',
          expiresAt: '2026-11-01T01:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    });

    it('E: fails when claimedPeriodQuantity leaves remaining period supply below demand', async () => {
      // periodSupply 10, claimed 8 → remaining 2 < demand 3
      repository.listCommitments.mockResolvedValue([
        commitment({
          commitmentId: 'cmt_used',
          quantity: 10,
          claimedPeriodQuantity: 8,
        }),
      ]);

      await expect(
        service.holdPlanCapacity({
          vendorId: 'vendor-1',
          communityId: 'com-1',
          offeringId: 'pkg_car_wash',
          demandQuantity: 3,
          planId: 'plan_e',
          expiresAt: '2026-11-01T01:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    });

    it('F: period supply covers two sequential plan claims without comparing to a single day', async () => {
      const match = commitment({ commitmentId: 'cmt_50', quantity: 50 });
      repository.listCommitments.mockResolvedValue([match]);
      repository.getCommitment
        .mockResolvedValueOnce({ ...match, claimedPeriodQuantity: 25 })
        .mockResolvedValueOnce({ ...match, claimedPeriodQuantity: 50 });

      await service.holdPlanCapacity({
        vendorId: 'vendor-1',
        communityId: 'com-1',
        offeringId: 'pkg_car_wash',
        demandQuantity: 25,
        planId: 'plan_f1',
        expiresAt: '2026-11-01T01:00:00.000Z',
      });
      repository.listCommitments.mockResolvedValue([
        { ...match, claimedPeriodQuantity: 25 },
      ]);
      await service.holdPlanCapacity({
        vendorId: 'vendor-1',
        communityId: 'com-1',
        offeringId: 'pkg_car_wash',
        demandQuantity: 25,
        planId: 'plan_f2',
        expiresAt: '2026-11-01T01:00:00.000Z',
      });

      expect(repository.reserveSoldCapacity).toHaveBeenCalledTimes(2);
      expect(repository.reserveSoldCapacity).toHaveBeenCalledWith(
        expect.objectContaining({ consumesDailySlots: false, periodSupply: 50 }),
      );
    });

    it('H: mismatched community commitment does not count', async () => {
      repository.listCommitments.mockResolvedValue([
        commitment({ commitmentId: 'cmt_other_com', communityId: 'com-other', quantity: 100 }),
      ]);

      await expect(
        service.holdPlanCapacity({
          vendorId: 'vendor-1',
          communityId: 'com-1',
          offeringId: 'pkg_car_wash',
          demandQuantity: 1,
          planId: 'plan_h',
          expiresAt: '2026-11-01T01:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    });

    it('I: mismatched offering / legacy serviceScopeCode-only commitment does not count', async () => {
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
          planId: 'plan_i',
          expiresAt: '2026-11-01T01:00:00.000Z',
        }),
      ).rejects.toThrow(BaseError);
      expect(repository.reserveSoldCapacity).not.toHaveBeenCalled();
    });

    it('J: period supply uses the commitment window service days (not a preferred-window guess)', async () => {
      // Nov 2026 has 30 days → periodSupply = 5 * 30 = 150
      const monthWindow = commitment({
        commitmentId: 'cmt_month',
        quantity: 5,
        window: {
          startDate: '2026-11-01',
          endDate: '2026-11-30',
          dailyWindow: { startTime: '09:00', endTime: '13:00' },
        },
      });
      repository.listCommitments.mockResolvedValue([monthWindow]);
      repository.getCommitment.mockResolvedValue({
        ...monthWindow,
        claimedPeriodQuantity: 1,
      });

      await expect(
        service.holdPlanCapacity({
          vendorId: 'vendor-1',
          communityId: 'com-1',
          offeringId: 'pkg_car_wash',
          demandQuantity: 1,
          planId: 'plan_j',
          expiresAt: '2026-11-01T01:00:00.000Z',
        }),
      ).resolves.toMatchObject({ commitmentId: 'cmt_month', periodSupply: 150 });

      expect(repository.reserveSoldCapacity).toHaveBeenCalledWith(
        expect.objectContaining({ periodSupply: 150, consumesDailySlots: false }),
      );
    });

    it('K: one matching commitment must independently satisfy period demand (no cross-sum)', async () => {
      repository.listCommitments.mockResolvedValue([
        commitment({ commitmentId: 'cmt_a', quantity: 3 }),
        commitment({ commitmentId: 'cmt_b', quantity: 3 }),
      ]);

      await expect(
        service.holdPlanCapacity({
          vendorId: 'vendor-1',
          communityId: 'com-1',
          offeringId: 'pkg_car_wash',
          demandQuantity: 5,
          planId: 'plan_k',
          expiresAt: '2026-11-01T01:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
      expect(repository.reserveSoldCapacity).not.toHaveBeenCalled();
    });

    it('L: release of a legacy daily-debit pointer passes consumesDailySlots true', async () => {
      repository.getSoldCapacityReservation.mockResolvedValue({
        PK: 'PLAN_SOLD_CAPACITY#plan_l',
        SK: 'RESERVE',
        planId: 'plan_l',
        vendorId: 'vendor-1',
        commitmentId: 'cmt_1',
        quantity: 4,
        idempotencyKey: 'plan_l',
        kind: 'sold',
        createdAt: '2026-11-01T00:00:00.000Z',
        entityType: 'PlanSoldCapacityReservation',
      });

      await service.releasePlanCapacity({ planId: 'plan_l' });

      expect(repository.releaseSoldCapacity).toHaveBeenCalledWith({
        vendorId: 'vendor-1',
        commitmentId: 'cmt_1',
        quantity: 4,
        planId: 'plan_l',
        consumesDailySlots: true,
      });
    });

    it('L2: release of a period-eligibility pointer passes consumesDailySlots false', async () => {
      repository.getSoldCapacityReservation.mockResolvedValue({
        PK: 'PLAN_SOLD_CAPACITY#plan_l2',
        SK: 'RESERVE',
        planId: 'plan_l2',
        vendorId: 'vendor-1',
        commitmentId: 'cmt_1',
        quantity: 4,
        idempotencyKey: 'plan_l2',
        kind: 'sold',
        consumesDailySlots: false,
        createdAt: '2026-11-01T00:00:00.000Z',
        entityType: 'PlanSoldCapacityReservation',
      });

      await service.releasePlanCapacity({ planId: 'plan_l2' });

      expect(repository.releaseSoldCapacity).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: 'plan_l2',
          consumesDailySlots: false,
        }),
      );
    });

    /**
     * M: production mismatch shape — lifetime demand 200 must not be compared to
     * daily quantity 2 alone. Over a 30-day window periodSupply = 2*30 = 60 < 200.
     */
    it('M: rejects TestFullWash demand=200 when period supply is only 60 (qty 2 × 30 days)', async () => {
      repository.listCommitments.mockResolvedValue([
        commitment({
          commitmentId: 'cmt_prod_shape',
          quantity: 2,
          communityId: 'com-anon-1',
          scope: { offeringId: 'pkg_test_full_wash', label: 'TestFullWash' },
          window: {
            startDate: '2026-11-01',
            endDate: '2026-11-30',
            dailyWindow: { startTime: '09:00', endTime: '13:00' },
          },
        }),
      ]);

      await expect(
        service.holdPlanCapacity({
          vendorId: 'vendor-1',
          communityId: 'com-anon-1',
          offeringId: 'pkg_test_full_wash',
          demandQuantity: 200,
          planId: 'plan_m',
          expiresAt: '2026-11-01T01:00:00.000Z',
        }),
      ).rejects.toMatchObject({
        code: 'CAPACITY_UNAVAILABLE',
        message: expect.stringContaining('demand=200'),
      });
    });

    /** Same demand succeeds once period supply uses matching grain (7 × 30 = 210). */
    it('M2: accepts TestFullWash demand=200 when period supply is 210 (qty 7 × 30 days)', async () => {
      const match = commitment({
        commitmentId: 'cmt_prod_ok',
        quantity: 7,
        communityId: 'com-anon-1',
        scope: { offeringId: 'pkg_test_full_wash', label: 'TestFullWash' },
        window: {
          startDate: '2026-11-01',
          endDate: '2026-11-30',
          dailyWindow: { startTime: '09:00', endTime: '13:00' },
        },
      });
      repository.listCommitments.mockResolvedValue([match]);
      repository.getCommitment.mockResolvedValue({
        ...match,
        claimedPeriodQuantity: 200,
      });

      await expect(
        service.holdPlanCapacity({
          vendorId: 'vendor-1',
          communityId: 'com-anon-1',
          offeringId: 'pkg_test_full_wash',
          demandQuantity: 200,
          planId: 'plan_m2',
          expiresAt: '2026-11-01T01:00:00.000Z',
        }),
      ).resolves.toMatchObject({ commitmentId: 'cmt_prod_ok', periodSupply: 210 });

      expect(repository.reserveSoldCapacity).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 200,
          periodSupply: 210,
          consumesDailySlots: false,
        }),
      );
    });

    it('confirm is idempotent when the plan pointer is already sold', async () => {
      const match = commitment({ commitmentId: 'cmt_sold' });
      repository.getSoldCapacityReservation.mockResolvedValue({
        PK: 'PLAN_SOLD_CAPACITY#plan_retry',
        SK: 'RESERVE',
        planId: 'plan_retry',
        vendorId: 'vendor-1',
        commitmentId: 'cmt_sold',
        quantity: 3,
        idempotencyKey: 'plan_retry',
        kind: 'sold',
        consumesDailySlots: false,
        createdAt: '2026-11-01T00:00:00.000Z',
        entityType: 'PlanSoldCapacityReservation',
      });
      repository.getCommitment.mockResolvedValue({
        ...match,
        claimedPeriodQuantity: 3,
      });

      await expect(
        service.confirmPlanCapacity({
          vendorId: 'vendor-1',
          communityId: 'com-1',
          offeringId: 'pkg_car_wash',
          demandQuantity: 3,
          planId: 'plan_retry',
        }),
      ).resolves.toMatchObject({ commitmentId: 'cmt_sold', kind: 'sold' });

      expect(repository.reserveSoldCapacity).not.toHaveBeenCalled();
      expect(repository.confirmCapacityHold).not.toHaveBeenCalled();
    });
  });

  describe('visit day ledger (schedule / reschedule / cancel)', () => {
    it('reserves visit demand against the matching service day', async () => {
      const match = commitment({ commitmentId: 'cmt_day', quantity: 4 });
      repository.listCommitments.mockResolvedValue([match]);
      repository.getCommitment.mockResolvedValue(match);
      repository.getCommitmentDaySold.mockResolvedValue({
        PK: 'VENDOR#vendor-1',
        SK: 'CAPACITY_DAY_SOLD#cmt_day#2026-11-01',
        vendorId: 'vendor-1',
        commitmentId: 'cmt_day',
        date: '2026-11-01',
        reservedSoldQuantity: 1,
        updatedAt: '2026-11-01T00:00:00.000Z',
        entityType: 'CommitmentDaySold',
      });

      const result = await service.reserveVisitCapacity({
        vendorId: 'vendor-1',
        communityId: 'com-1',
        offeringId: 'pkg_car_wash',
        planId: 'plan_1',
        visitId: 'visit_1',
        date: '2026-11-01',
        startTime: '09:00',
        endTime: '09:30',
        demandQuantity: 1,
      });

      expect(repository.reserveVisitSoldCapacity).toHaveBeenCalledWith(
        expect.objectContaining({
          commitmentId: 'cmt_day',
          date: '2026-11-01',
          quantity: 1,
          commitmentQuantity: 4,
        }),
      );
      expect(result).toMatchObject({
        commitmentId: 'cmt_day',
        date: '2026-11-01',
        remainingSoldCapacity: 3,
      });
    });

    it('rejects when the specific date has insufficient remaining day capacity', async () => {
      const match = commitment({ commitmentId: 'cmt_full', quantity: 2 });
      repository.listCommitments.mockResolvedValue([match]);
      repository.getCommitmentDaySold.mockResolvedValue({
        PK: 'VENDOR#vendor-1',
        SK: 'CAPACITY_DAY_SOLD#cmt_full#2026-11-01',
        vendorId: 'vendor-1',
        commitmentId: 'cmt_full',
        date: '2026-11-01',
        reservedSoldQuantity: 2,
        updatedAt: '2026-11-01T00:00:00.000Z',
        entityType: 'CommitmentDaySold',
      });

      await expect(
        service.reserveVisitCapacity({
          vendorId: 'vendor-1',
          communityId: 'com-1',
          offeringId: 'pkg_car_wash',
          planId: 'plan_1',
          visitId: 'visit_full',
          date: '2026-11-01',
          startTime: '09:00',
          endTime: '09:30',
          demandQuantity: 1,
        }),
      ).rejects.toMatchObject({
        code: 'CAPACITY_UNAVAILABLE',
        message: expect.stringContaining('date=2026-11-01'),
      });
      expect(repository.reserveVisitSoldCapacity).not.toHaveBeenCalled();
    });

    it('rejects when the visit time is outside the commitment daily window', async () => {
      repository.listCommitments.mockResolvedValue([
        commitment({ commitmentId: 'cmt_hours', quantity: 10 }),
      ]);

      await expect(
        service.reserveVisitCapacity({
          vendorId: 'vendor-1',
          communityId: 'com-1',
          offeringId: 'pkg_car_wash',
          planId: 'plan_1',
          visitId: 'visit_late',
          date: '2026-11-01',
          startTime: '14:00',
          endTime: '14:30',
          demandQuantity: 1,
        }),
      ).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    });

    it('rejects when the date is outside the commitment service window', async () => {
      repository.listCommitments.mockResolvedValue([
        commitment({ commitmentId: 'cmt_range', quantity: 10 }),
      ]);

      await expect(
        service.reserveVisitCapacity({
          vendorId: 'vendor-1',
          communityId: 'com-1',
          offeringId: 'pkg_car_wash',
          planId: 'plan_1',
          visitId: 'visit_out',
          date: '2026-12-01',
          startTime: '09:00',
          endTime: '09:30',
          demandQuantity: 1,
        }),
      ).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    });

    it('is idempotent when the same visit/date/quantity is reserved again', async () => {
      repository.getVisitSoldCapacityReservation.mockResolvedValue({
        PK: 'VISIT_SOLD_CAPACITY#visit_idem',
        SK: 'RESERVE',
        visitId: 'visit_idem',
        planId: 'plan_1',
        vendorId: 'vendor-1',
        commitmentId: 'cmt_1',
        date: '2026-11-01',
        quantity: 1,
        createdAt: '2026-11-01T00:00:00.000Z',
        entityType: 'VisitSoldCapacityReservation',
      });
      repository.getCommitment.mockResolvedValue(commitment());
      repository.getCommitmentDaySold.mockResolvedValue({
        PK: 'VENDOR#vendor-1',
        SK: 'CAPACITY_DAY_SOLD#cmt_1#2026-11-01',
        vendorId: 'vendor-1',
        commitmentId: 'cmt_1',
        date: '2026-11-01',
        reservedSoldQuantity: 1,
        updatedAt: '2026-11-01T00:00:00.000Z',
        entityType: 'CommitmentDaySold',
      });

      await expect(
        service.reserveVisitCapacity({
          vendorId: 'vendor-1',
          communityId: 'com-1',
          offeringId: 'pkg_car_wash',
          planId: 'plan_1',
          visitId: 'visit_idem',
          date: '2026-11-01',
          startTime: '09:00',
          endTime: '09:30',
          demandQuantity: 1,
        }),
      ).resolves.toMatchObject({ commitmentId: 'cmt_1', date: '2026-11-01' });

      expect(repository.reserveVisitSoldCapacity).not.toHaveBeenCalled();
    });

    it('releases a visit day debit for cancel / reschedule-away', async () => {
      repository.getVisitSoldCapacityReservation.mockResolvedValue({
        PK: 'VISIT_SOLD_CAPACITY#visit_rel',
        SK: 'RESERVE',
        visitId: 'visit_rel',
        planId: 'plan_1',
        vendorId: 'vendor-1',
        commitmentId: 'cmt_1',
        date: '2026-11-01',
        quantity: 2,
        createdAt: '2026-11-01T00:00:00.000Z',
        entityType: 'VisitSoldCapacityReservation',
      });

      await service.releaseVisitCapacity({ visitId: 'visit_rel' });

      expect(repository.releaseVisitSoldCapacity).toHaveBeenCalledWith({
        vendorId: 'vendor-1',
        commitmentId: 'cmt_1',
        visitId: 'visit_rel',
        date: '2026-11-01',
        quantity: 2,
      });
    });
  });
});
