import {
  computeVisitProgress,
  earliestConfirmedServiceDate,
  enrichVisitFromPlan,
  materializePackageVisits,
  operationalSnapshot,
  planVisitSlotDemand,
  validityEndsAt,
  visitCoversDate,
  visitHasDatedCommitment,
} from './package-visit';
import { CustomerPlanRecord } from '../types/customer-plan.types';
import { PACKAGE_VISIT_STATUS, PackageVisitRecord } from '../types/package-visit.types';

const plan = {
  planId: 'plan-1',
  customerId: 'customer-1',
  vendorId: 'vendor-1',
  packageId: 'pkg',
  offeringId: 'pkg',
  vehicleId: 'veh-1',
  vehicleType: 'SEDAN',
  status: 'PENDING_PAYMENT',
  paymentStatus: 'PENDING',
  billingPeriod: 'oneTime',
  cadence: 'ONE_TIME',
  remainingVisits: 3,
  entitlements: [
    { serviceId: 'exterior-wash', quantity: 2 },
    { serviceId: 'interior-wash', quantity: 1 },
  ],
  includedServices: [
    { name: 'Exterior', serviceKey: 'exterior-wash', categoryId: 'cat', visitsPerPeriod: 2, durationMinutes: 30 },
    { name: 'Interior', serviceKey: 'interior-wash', categoryId: 'cat', visitsPerPeriod: 1, durationMinutes: 45 },
  ],
  visitWindowId: 'morning',
  visitWindow: { visitWindowId: 'morning', label: 'Morning' },
  location: { fulfilmentType: 'community', communityId: 'c1' },
  pricingSnapshot: {
    totalAmount: 1999,
    totalMinor: 1999,
    currency: 'INR',
    packageId: 'pkg',
    offeringId: 'pkg',
    vehicleType: 'SEDAN',
  },
  autoRenew: false,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as CustomerPlanRecord;

describe('package visit domain', () => {
  describe('parking bay snapshot', () => {
    const withBay = { ...plan, location: { ...plan.location, addressId: 'addr-private', parkingBay: ' B2-14 ' } } as CustomerPlanRecord;

    it('copies only the trimmed bay label from the plan location', () => {
      const snapshot = operationalSnapshot(withBay);
      expect(snapshot.parkingBay).toBe('B2-14');
      expect(JSON.stringify(snapshot)).not.toContain('addr-private');
      expect(materializePackageVisits({ plan: withBay, now: '2026-01-01T00:00:00.000Z' })[0].parkingBay).toBe('B2-14');
    });

    it('omits the bay when the plan has none', () => {
      expect(operationalSnapshot(plan)).not.toHaveProperty('parkingBay');
      expect(operationalSnapshot({ ...plan, location: { ...plan.location, parkingBay: '   ' } } as CustomerPlanRecord)).not.toHaveProperty('parkingBay');
    });

    it('fills a legacy visit from its plan but keeps a bay already on the visit', () => {
      const [visit] = materializePackageVisits({ plan, now: '2026-01-01T00:00:00.000Z' });
      expect(enrichVisitFromPlan(visit, withBay).parkingBay).toBe('B2-14');
      expect(enrichVisitFromPlan({ ...visit, parkingBay: 'A1' }, withBay).parkingBay).toBe('A1');
    });
  });

  it('materializes one visit per entitlement unit', () => {
    const visits = materializePackageVisits({ plan, now: '2026-01-01T00:00:00.000Z' });
    expect(visits).toHaveLength(3);
    expect(visits.map((v) => v.serviceId)).toEqual([
      'exterior-wash',
      'exterior-wash',
      'interior-wash',
    ]);
    expect(visits.every((v) => v.status === PACKAGE_VISIT_STATUS.UNSCHEDULED)).toBe(true);
    expect(visits[2].durationMinutes).toBe(45);
    expect(visits[0].ordinal).toBe(1);
    expect(visits[2].ordinal).toBe(3);
  });

   
  it('computes progress without double-counting completed entitlements', () => {
    const base = materializePackageVisits({ plan, now: '2026-01-01T00:00:00.000Z' });
    const visits: PackageVisitRecord[] = [
      { ...base[0], status: 'COMPLETED', entitlementConsumed: true },
      { ...base[1], status: 'SCHEDULED', schedule: {
        date: '2026-01-02', startTime: '09:00', timezone: 'Asia/Kolkata', branchId: 'b1', durationMinutes: 30,
      } },
      { ...base[2], status: 'UNSCHEDULED' },
    ];
    const progress = computeVisitProgress(visits);
    expect(progress.totalVisits).toBe(3);
    expect(progress.completedVisits).toBe(1);
    expect(progress.remainingVisits).toBe(2);
    expect(progress.scheduledVisits).toBe(1);
    expect(progress.unscheduledVisits).toBe(1);
    expect(progress.byService.find((s) => s.serviceId === 'exterior-wash')).toMatchObject({
      total: 2,
      completed: 1,
      remaining: 1,
    });
  });

  it('computes validity end from activatedAt and validityDays', () => {
    expect(validityEndsAt('2026-01-01T00:00:00.000Z', 30)).toBe('2026-01-31T00:00:00.000Z');
    expect(validityEndsAt('2026-01-01T00:00:00.000Z', undefined)).toBeUndefined();
  });

  it('treats inclusive range commitments as covering each civil day', () => {
    const [base] = materializePackageVisits({ plan, now: '2026-01-01T00:00:00.000Z' });
    const ranged: PackageVisitRecord = {
      ...base,
      status: 'SCHEDULED',
      scheduleStartDate: '2026-11-23',
      scheduleEndDate: '2026-11-29',
    };
    expect(visitHasDatedCommitment(ranged)).toBe(true);
    expect(visitCoversDate(ranged, '2026-11-23')).toBe(true);
    expect(visitCoversDate(ranged, '2026-11-26')).toBe(true);
    expect(visitCoversDate(ranged, '2026-11-29')).toBe(true);
    expect(visitCoversDate(ranged, '2026-11-22')).toBe(false);
    expect(visitCoversDate(ranged, '2026-11-30')).toBe(false);
  });

  describe('earliestConfirmedServiceDate', () => {
    it('returns undefined when no confirmed slots exist', () => {
      const visits = materializePackageVisits({ plan, now: '2026-01-01T00:00:00.000Z' });
      expect(earliestConfirmedServiceDate(visits)).toBeUndefined();
    });

    it('uses the earliest exact slot civil date, not confirmation order', () => {
      const [a, b, c] = materializePackageVisits({ plan, now: '2026-01-01T00:00:00.000Z' });
      expect(earliestConfirmedServiceDate([
        {
          ...a,
          status: 'SCHEDULED',
          schedule: {
            date: '2026-11-29',
            startTime: '10:00',
            timezone: 'Asia/Kolkata',
            branchId: 'b1',
            durationMinutes: 30,
          },
        },
        {
          ...b,
          status: 'SCHEDULED',
          schedule: {
            date: '2026-11-28',
            startTime: '09:00',
            timezone: 'Asia/Kolkata',
            branchId: 'b1',
            durationMinutes: 30,
          },
        },
        { ...c, status: 'UNSCHEDULED' },
      ])).toBe('2026-11-28');
    });

    it('prefers range commitment start and ignores cancelled visits', () => {
      const [a, b] = materializePackageVisits({ plan, now: '2026-01-01T00:00:00.000Z' });
      expect(earliestConfirmedServiceDate([
        {
          ...a,
          status: 'CANCELLED',
          schedule: {
            date: '2026-11-20',
            startTime: '09:00',
            timezone: 'Asia/Kolkata',
            branchId: 'b1',
            durationMinutes: 30,
          },
        },
        {
          ...b,
          status: 'SCHEDULED',
          scheduleStartDate: '2026-11-28',
          scheduleEndDate: '2026-11-30',
        },
      ])).toBe('2026-11-28');
    });
  });

  describe('planVisitSlotDemand', () => {
    it('G: rounds 45- and 60-minute washes up by 30-minute slot units', () => {
      expect(
        planVisitSlotDemand({
          entitlements: [{ serviceId: 'wash-45', quantity: 2 }],
          includedServices: [
            {
              name: 'Wash 45',
              serviceKey: 'wash-45',
              categoryId: 'cat',
              visitsPerPeriod: 2,
              durationMinutes: 45,
            },
          ],
        }),
      ).toBe(4); // 2 * ceil(45/30) = 2 * 2
      expect(
        planVisitSlotDemand({
          entitlements: [{ serviceId: 'wash-60', quantity: 3 }],
          includedServices: [
            {
              name: 'Wash 60',
              serviceKey: 'wash-60',
              categoryId: 'cat',
              visitsPerPeriod: 3,
              durationMinutes: 60,
            },
          ],
        }),
      ).toBe(6); // 3 * ceil(60/30) = 3 * 2
    });

    it('F: 30-minute washes consume one slot-unit per entitlement', () => {
      expect(
        planVisitSlotDemand({
          entitlements: [{ serviceId: 'wash-30', quantity: 50 }],
          includedServices: [
            {
              name: 'Wash 30',
              serviceKey: 'wash-30',
              categoryId: 'cat',
              visitsPerPeriod: 50,
              durationMinutes: 30,
            },
          ],
        }),
      ).toBe(50);
    });

    it('M: anonymised TestFullWash shape yields period demand=200 (100+100 × 1 slot)', () => {
      // Period demand only — compared to quantity×serviceDays at payment, not to
      // a single day's commitment quantity. Package PA-… TestFullWash: 100 exterior
      // (15m) + 100 interior (20m). Both ceil to 1 slot-unit → demand 200 per plan.
      const demand = planVisitSlotDemand({
        entitlements: [
          { serviceId: 'full_wash_exterior', quantity: 100 },
          { serviceId: 'full_wash_interior', quantity: 100 },
        ],
        includedServices: [
          {
            name: 'Exterior Wash and Dry',
            serviceKey: 'full_wash_exterior',
            categoryId: 'cat-full-wash',
            visitsPerPeriod: 100,
            durationMinutes: 15,
          },
          {
            name: 'Cabin Vacuum and Surface Wipe',
            serviceKey: 'full_wash_interior',
            categoryId: 'cat-full-wash',
            visitsPerPeriod: 100,
            durationMinutes: 20,
          },
        ],
      });
      expect(demand).toBe(200);
    });
  });
});
