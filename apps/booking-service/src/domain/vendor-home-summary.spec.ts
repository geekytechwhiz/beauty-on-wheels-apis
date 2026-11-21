import { Booking } from '../types/api-types';
import { PACKAGE_VISIT_STATUS, PackageVisitRecord } from '../types/package-visit.types';
import { VendorHomeSummarySchema } from '../schemas/vendor-home-summary.schema';
import {
  parseHomeSummaryQuery,
  summarizeVendorHome,
} from './vendor-home-summary';

function visit(overrides: Partial<PackageVisitRecord> = {}): PackageVisitRecord {
  return {
    visitId: 'visit-1',
    planId: 'plan-1',
    customerId: 'customer-1',
    vendorId: 'vendor-1',
    communityId: 'CO123456',
    visitWindowId: 'VW123456',
    visitWindowName: 'Evening',
    serviceId: 'exterior',
    serviceName: 'Exterior Wash',
    sequence: 1,
    ordinal: 1,
    status: PACKAGE_VISIT_STATUS.SCHEDULED,
    durationMinutes: 30,
    schedule: {
      date: '2026-11-20',
      startTime: '18:00',
      timezone: 'Asia/Kolkata',
      branchId: 'branch-1',
      durationMinutes: 30,
    },
    scheduleHistory: [],
    entitlementConsumed: false,
    version: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('vendor home summary domain', () => {
  it('parses date and upcomingDays with defaults', () => {
    const range = parseHomeSummaryQuery({}, new Date('2026-11-20T08:00:00.000Z'), 'Asia/Kolkata');
    expect(range.date).toBe('2026-11-20');
    expect(range.upcomingDays).toBe(3);
    expect(range.toDate).toBe('2026-11-23');
  });

  it('rejects upcomingDays outside 1–7', () => {
    expect(() => parseHomeSummaryQuery({ upcomingDays: '0' }, new Date(), 'Asia/Kolkata'))
      .toThrow(/upcomingDays/);
    expect(() => parseHomeSummaryQuery({ upcomingDays: '8' }, new Date(), 'Asia/Kolkata'))
      .toThrow(/upcomingDays/);
  });

  it('counts statuses, crew, completion, and needsAttention without double-counting', () => {
    const visits = [
      visit({ visitId: 'c1', status: PACKAGE_VISIT_STATUS.COMPLETED }),
      visit({ visitId: 'c2', status: PACKAGE_VISIT_STATUS.COMPLETED }),
      visit({
        visitId: 'ip',
        status: PACKAGE_VISIT_STATUS.IN_PROGRESS,
        crewAssignment: { crewId: 'crew-1', assignedAt: '2026-11-20T01:00:00.000Z', assignedBy: 'owner-1' },
      }),
      visit({
        visitId: 'ns1',
        status: PACKAGE_VISIT_STATUS.SCHEDULED,
        crewAssignment: { crewId: 'crew-1', assignedAt: '2026-11-20T01:00:00.000Z', assignedBy: 'owner-1' },
      }),
      visit({ visitId: 'ns2', status: PACKAGE_VISIT_STATUS.SCHEDULED }),
      visit({
        visitId: 'bl1',
        status: PACKAGE_VISIT_STATUS.BLOCKED,
        blockReason: 'Access blocked',
        blockedAt: '2026-11-20T02:00:00.000Z',
        blockedBy: 'owner-1',
      }),
      visit({
        visitId: 'bl2',
        status: PACKAGE_VISIT_STATUS.BLOCKED,
        blockReason: 'Keys missing',
        blockedAt: '2026-11-20T02:00:00.000Z',
        blockedBy: 'owner-1',
        crewAssignment: { crewId: 'crew-1', assignedAt: '2026-11-20T01:00:00.000Z', assignedBy: 'owner-1' },
      }),
      visit({ visitId: 'cancel', status: PACKAGE_VISIT_STATUS.CANCELLED }),
      visit({
        visitId: 'tomorrow',
        status: PACKAGE_VISIT_STATUS.SCHEDULED,
        schedule: {
          date: '2026-11-21',
          startTime: '09:00',
          timezone: 'Asia/Kolkata',
          branchId: 'branch-1',
          durationMinutes: 30,
        },
      }),
      visit({
        visitId: 'day3',
        status: PACKAGE_VISIT_STATUS.SCHEDULED,
        communityId: 'CO123456',
        schedule: {
          date: '2026-11-22',
          startTime: '09:00',
          timezone: 'Asia/Kolkata',
          branchId: 'branch-1',
          durationMinutes: 30,
        },
      }),
    ];

    const result = summarizeVendorHome({
      vendorId: 'VN123456',
      timezone: 'Asia/Kolkata',
      date: '2026-11-20',
      upcomingDays: 3,
      visits,
    });

    expect(result.today.visits).toEqual({
      total: 7,
      completed: 2,
      inProgress: 1,
      notStarted: 2,
      blocked: 2,
      missed: 0,
      cancelled: 1,
    });
    expect(result.today.crew).toEqual({ assigned: 3, unassigned: 4 });
    expect(result.today.completion).toEqual({ completed: 2, total: 7, percentage: 29 });
    expect(result.today.needsAttention).toEqual([
      expect.objectContaining({
        communityId: 'CO123456',
        visitWindowId: 'VW123456',
        visitWindowName: 'Evening',
        visitCount: 3,
        blockedCount: 2,
        unassignedCount: 2,
      }),
    ]);
    expect(result.tomorrow).toEqual({
      date: '2026-11-21',
      totalVisits: 1,
      assignedVisits: 0,
      unassignedVisits: 1,
    });
    expect(result.upcoming.fromDate).toBe('2026-11-21');
    expect(result.upcoming.toDate).toBe('2026-11-23');
    expect(result.upcoming.days).toHaveLength(3);
    expect(result.upcoming.days[1]).toEqual({
      date: '2026-11-22',
      totalVisits: 1,
      assignedVisits: 0,
      unassignedVisits: 1,
      communities: [{
        communityId: 'CO123456',
        visitCount: 1,
        unassignedCount: 1,
      }],
    });
    expect(result.upcoming.days[2].communities).toEqual([]);
    expect(VendorHomeSummarySchema.safeParse(result).success).toBe(true);
  });

  it('returns zero completion percentage when the denominator is zero', () => {
    const result = summarizeVendorHome({
      vendorId: 'VN123456',
      timezone: 'Asia/Kolkata',
      date: '2026-11-20',
      upcomingDays: 1,
      visits: [],
    });
    expect(result.today.completion).toEqual({ completed: 0, total: 0, percentage: 0 });
  });

  it('excludes UNSCHEDULED from totals', () => {
    const result = summarizeVendorHome({
      vendorId: 'VN123456',
      timezone: 'Asia/Kolkata',
      date: '2026-11-20',
      upcomingDays: 1,
      visits: [visit({ status: PACKAGE_VISIT_STATUS.UNSCHEDULED, schedule: undefined })],
    });
    expect(result.today.visits.total).toBe(0);
  });

  it('includes one-time bookings and skips package-linked bookings', () => {
    const oneTime: Booking = {
      id: 'booking-1',
      bookingDate: '2026-11-20',
      bookingStatus: 'CONFIRMED',
      schedule: {
        date: '2026-11-20',
        startTime: '10:00',
        endTime: '10:45',
        durationMinutes: 45,
        timezone: 'Asia/Kolkata',
        startAtUtc: '2026-11-20T04:30:00.000Z',
        endAtUtc: '2026-11-20T05:15:00.000Z',
      },
      location: { fulfilmentType: 'community', communityId: 'CO123456' },
    };
    const linked: Booking = {
      ...oneTime,
      id: 'booking-linked',
      planId: 'plan-1',
    };

    const result = summarizeVendorHome({
      vendorId: 'VN123456',
      timezone: 'Asia/Kolkata',
      date: '2026-11-20',
      upcomingDays: 1,
      visits: [visit({ visitId: 'v1', status: PACKAGE_VISIT_STATUS.SCHEDULED })],
      bookings: [oneTime, linked],
    });

    expect(result.today.visits.total).toBe(2);
    expect(result.today.visits.notStarted).toBe(2);
    // One-time booking is excluded from crew metrics.
    expect(result.today.crew).toEqual({ assigned: 0, unassigned: 1 });
  });
});
