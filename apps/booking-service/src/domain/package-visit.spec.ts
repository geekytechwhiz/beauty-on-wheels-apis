import {
  assertVisitTransition,
  computeVisitProgress,
  materializePackageVisits,
  validityEndsAt,
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

  it('allows documented transitions and rejects illegal ones', () => {
    expect(() => assertVisitTransition('UNSCHEDULED', 'SCHEDULED')).not.toThrow();
    expect(() => assertVisitTransition('SCHEDULED', 'IN_PROGRESS')).not.toThrow();
    expect(() => assertVisitTransition('IN_PROGRESS', 'COMPLETED')).not.toThrow();
    expect(() => assertVisitTransition('COMPLETED', 'SCHEDULED')).toThrow(/Cannot transition/);
    expect(() => assertVisitTransition('UNSCHEDULED', 'COMPLETED')).toThrow(/Cannot transition/);
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
});
