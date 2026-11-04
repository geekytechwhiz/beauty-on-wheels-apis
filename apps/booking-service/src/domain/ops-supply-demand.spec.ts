import { PACKAGE_VISIT_STATUS, PackageVisitRecord } from '../types/package-visit.types';
import { aggregateDemand, visitSlotUnits } from './ops-supply-demand';

function visit(overrides: Partial<PackageVisitRecord>): PackageVisitRecord {
  return {
    visitId: 'visit-1',
    planId: 'plan-1',
    customerId: 'customer-1',
    vendorId: 'vendor-1',
    communityId: 'community-1',
    visitWindowId: 'morning',
    visitWindowName: 'Morning',
    serviceId: 'wash',
    serviceName: 'Exterior',
    sequence: 1,
    ordinal: 1,
    status: PACKAGE_VISIT_STATUS.SCHEDULED,
    durationMinutes: 45,
    scheduleHistory: [],
    entitlementConsumed: false,
    version: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    schedule: {
      date: '2026-11-03',
      startTime: '08:00',
      endTime: '09:00',
      timezone: 'Asia/Kolkata',
      branchId: 'branch-1',
      durationMinutes: 45,
    },
    ...overrides,
  };
}

describe('ops supply demand', () => {
  it('rounds visit duration up to 30-minute slot units', () => {
    expect(visitSlotUnits(30)).toBe(1);
    expect(visitSlotUnits(45)).toBe(2);
    expect(visitSlotUnits(undefined)).toBe(1);
  });

  it('counts booked demand separately from cancelled visits', () => {
    const result = aggregateDemand([
      visit({ visitId: 'a', durationMinutes: 45 }),
      visit({ visitId: 'b', status: PACKAGE_VISIT_STATUS.COMPLETED, durationMinutes: 30 }),
      visit({ visitId: 'c', status: PACKAGE_VISIT_STATUS.CANCELLED, durationMinutes: 90 }),
      visit({ visitId: 'd', status: PACKAGE_VISIT_STATUS.UNSCHEDULED, schedule: undefined }),
    ]);
    expect(result.totals).toMatchObject({
      demandVisits: 2,
      demandSlotUnits: 3,
      scheduled: 1,
      completed: 1,
      cancelled: 1,
    });
    expect(result.byWindow).toHaveLength(1);
    expect(result.byWindow[0].visitWindowId).toBe('morning');
  });
});
