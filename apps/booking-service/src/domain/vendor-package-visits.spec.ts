import { PACKAGE_VISIT_STATUS, PackageVisitRecord } from '../types/package-visit.types';
import {
  calendarDateInTimeZone,
  parseSummaryRange,
  parseVendorVisitQuery,
  summarizeVendorVisits,
  visitMatchesFilters,
} from './vendor-package-visits';

function visit(overrides: Partial<PackageVisitRecord> = {}): PackageVisitRecord {
  return {
    visitId: 'visit-1',
    planId: 'plan-1',
    customerId: 'customer-1',
    vendorId: 'vendor-1',
    communityId: 'community-1',
    visitWindowId: 'night',
    visitWindowName: 'Night',
    vehicleId: 'vehicle-1',
    registrationNumber: 'KL07AB1234',
    vehicleDisplayName: 'Hyundai i20',
    serviceId: 'exterior',
    serviceName: 'Exterior Wash',
    sequence: 1,
    ordinal: 1,
    status: PACKAGE_VISIT_STATUS.SCHEDULED,
    durationMinutes: 30,
    schedule: {
      date: '2026-10-29',
      startTime: '21:00',
      timezone: 'Asia/Kolkata',
      branchId: 'branch-1',
      durationMinutes: 30,
    },
    scheduleHistory: [],
    entitlementConsumed: false,
    version: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const now = new Date('2026-10-29T02:30:00.000Z');

describe('vendor package visit queries', () => {
  it('uses the India calendar date around midnight UTC', () => {
    expect(calendarDateInTimeZone(now)).toBe('2026-10-29');
    expect(calendarDateInTimeZone(new Date('2026-10-28T20:00:00.000Z'))).toBe('2026-10-29');
    expect(calendarDateInTimeZone(new Date('2026-10-28T18:00:00.000Z'))).toBe('2026-10-28');
  });

  it('defaults a missing date to today and rejects an inverted range', () => {
    expect(parseVendorVisitQuery({}, now)).toMatchObject({ fromDate: '2026-10-29', toDate: '2026-10-29', limit: 20 });
    expect(() => parseVendorVisitQuery({ fromDate: '2026-10-30', toDate: '2026-10-29' }, now)).toThrow(/fromDate/);
    expect(() => parseVendorVisitQuery({ date: '2026-10-29', fromDate: '2026-10-29' }, now)).toThrow(/cannot be combined/);
    expect(() => parseVendorVisitQuery({ status: 'Active' }, now)).toThrow(/status/);
    expect(() => parseVendorVisitQuery({ limit: '0' }, now)).toThrow(/limit/);
  });

  it('defaults the summary to seven India days', () => {
    expect(parseSummaryRange({}, now)).toEqual({
      fromDate: '2026-10-29',
      toDate: '2026-11-04',
      today: '2026-10-29',
    });
  });

  it('matches registration search without treating unscheduled rows as dated', () => {
    expect(visitMatchesFilters(visit(), { search: 'kl07ab' })).toBe(true);
    expect(visitMatchesFilters(visit(), { search: 'MH01' })).toBe(false);
    expect(visitMatchesFilters(visit({ status: 'UNSCHEDULED', schedule: undefined }), {})).toBe(false);
    expect(visitMatchesFilters(visit({ communityId: 'other' }), { communityId: 'community-1' })).toBe(false);
  });
});

describe('summarizeVendorVisits', () => {
  const rows = [
    visit(),
    visit({
      visitId: 'visit-2',
      status: PACKAGE_VISIT_STATUS.COMPLETED,
      entitlementConsumed: true,
    }),
    visit({
      visitId: 'visit-3',
      status: PACKAGE_VISIT_STATUS.IN_PROGRESS,
      communityId: 'community-2',
      visitWindowId: 'morning',
      visitWindowName: 'Morning',
    }),
    visit({
      visitId: 'visit-4',
      status: PACKAGE_VISIT_STATUS.MISSED,
    }),
    visit({
      visitId: 'visit-5',
      status: PACKAGE_VISIT_STATUS.CANCELLED,
    }),
    visit({
      visitId: 'visit-6',
      status: PACKAGE_VISIT_STATUS.UNSCHEDULED,
      schedule: undefined,
    }),
    visit({
      visitId: 'visit-7',
      status: PACKAGE_VISIT_STATUS.SCHEDULED,
      schedule: {
        date: '2026-10-30',
        startTime: '06:00',
        timezone: 'Asia/Kolkata',
        branchId: 'branch-1',
        durationMinutes: 30,
      },
      communityId: 'community-1',
      visitWindowId: 'early',
      visitWindowName: 'Early Morning',
    }),
  ];

  const summary = summarizeVendorVisits({
    visits: rows,
    today: '2026-10-29',
    fromDate: '2026-10-29',
    toDate: '2026-11-04',
  });

  it('keeps today totals consistent and leaves cancelled and unscheduled out of expected', () => {
    expect(summary.metrics).toEqual({
      expected: 4,
      completed: 1,
      inProgress: 1,
      waiting: 1,
      missed: 1,
      cancelled: 1,
      completionPercent: 25,
    });
    expect(summary.metrics.expected).toBe(
      summary.metrics.completed + summary.metrics.inProgress + summary.metrics.waiting + summary.metrics.missed,
    );
  });

  it('groups unresolved visits and community progress from the same definitions', () => {
    expect(summary.needsAttention).toEqual([
      expect.objectContaining({ communityId: 'community-1', visitWindowId: 'night', waiting: 1 }),
    ]);
    expect(summary.communities).toEqual([
      expect.objectContaining({ communityId: 'community-1', scheduled: 3, completed: 1, waiting: 1, inProgress: 0 }),
      expect.objectContaining({ communityId: 'community-2', scheduled: 1, inProgress: 1, waiting: 0, completed: 0 }),
    ]);
  });

  it('counts only dated non-cancelled visits across the seven days', () => {
    expect(summary.demand.totalScheduled).toBe(5);
    expect(summary.demand.days).toHaveLength(7);
    expect(summary.demand.days[0]).toEqual({ date: '2026-10-29', count: 4 });
    expect(summary.demand.days[1]).toEqual({ date: '2026-10-30', count: 1 });
    expect(summary.demand.days[2].count).toBe(0);
    expect(summary.demand.nextGroup).toEqual(expect.objectContaining({
      date: '2026-10-29',
      communityId: 'community-1',
      visitWindowId: 'night',
    }));
  });

  it('returns zero completion when nothing is expected', () => {
    const empty = summarizeVendorVisits({
      visits: [],
      today: '2026-10-29',
      fromDate: '2026-10-29',
      toDate: '2026-10-29',
    });
    expect(empty.metrics.completionPercent).toBe(0);
    expect(empty.demand.totalScheduled).toBe(0);
    expect(empty.demand.nextGroup).toBeNull();
  });
});
