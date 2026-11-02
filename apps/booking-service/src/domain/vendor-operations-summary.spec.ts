import { ValidationError } from '@api-hub/utils';

import { Booking } from '../types/api-types';
import { PACKAGE_VISIT_STATUS, PackageVisitRecord } from '../types/package-visit.types';
import { VendorOperationsSummarySchema } from '../schemas/vendor-operations-summary.schema';
import {
  oneTimeBookingToWorkUnit,
  packageVisitToWorkUnit,
  parseOperationsSummaryRange,
  resolveVendorTimezone,
  summarizeVendorOperations,
} from './vendor-operations-summary';

function visit(overrides: Partial<PackageVisitRecord> = {}): PackageVisitRecord {
  return {
    visitId: 'visit-1',
    planId: 'plan-1',
    customerId: 'customer-1',
    vendorId: 'vendor-1',
    communityId: 'community-1',
    visitWindowId: 'night',
    visitWindowName: 'Night',
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

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'booking-1',
    customerId: 'customer-2',
    vendorId: 'vendor-1',
    bookingDate: '2026-10-29',
    bookingStatus: 'CONFIRMED',
    schedule: {
      date: '2026-10-29',
      startTime: '10:00',
      endTime: '10:45',
      durationMinutes: 45,
      timezone: 'Asia/Kolkata',
      startAtUtc: '2026-10-29T04:30:00.000Z',
      endAtUtc: '2026-10-29T05:15:00.000Z',
    },
    location: {
      fulfilmentType: 'community',
      communityId: 'community-1',
    },
    ...overrides,
  };
}

describe('parseOperationsSummaryRange', () => {
  it('requires both dates and rejects malformed or reversed ranges', () => {
    expect(() => parseOperationsSummaryRange({})).toThrow(ValidationError);
    expect(() => parseOperationsSummaryRange({ fromDate: '2026-10-29' })).toThrow(/toDate/);
    expect(() => parseOperationsSummaryRange({ fromDate: '29-10-2026', toDate: '2026-10-29' }))
      .toThrow(/fromDate/);
    expect(() => parseOperationsSummaryRange({ fromDate: '2026-10-30', toDate: '2026-10-29' }))
      .toThrow(/fromDate must be on or before toDate/);
    expect(parseOperationsSummaryRange({ fromDate: '2026-10-29', toDate: '2026-10-29' }))
      .toEqual({ fromDate: '2026-10-29', toDate: '2026-10-29' });
  });
});

describe('resolveVendorTimezone', () => {
  it('requires a single valid IANA timezone and never invents UTC', () => {
    expect(resolveVendorTimezone(['Asia/Kolkata', ' Asia/Kolkata '])).toBe('Asia/Kolkata');
    expect(() => resolveVendorTimezone([])).toThrow(/could not be resolved/);
    expect(() => resolveVendorTimezone(['Asia/Kolkata', 'America/New_York'])).toThrow(/conflicting/);
    expect(() => resolveVendorTimezone(['Not/AZone'])).toThrow(/IANA/);
  });
});

describe('summarizeVendorOperations', () => {
  const visits = [
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
      visitId: 'visit-outside',
      schedule: {
        date: '2026-10-30',
        startTime: '06:00',
        timezone: 'Asia/Kolkata',
        branchId: 'branch-1',
        durationMinutes: 30,
      },
    }),
  ];

  const bookings = [
    booking(),
    booking({
      id: 'booking-completed',
      bookingStatus: 'COMPLETED',
      location: { fulfilmentType: 'community', communityId: 'community-2' },
    }),
    booking({
      id: 'booking-cancelled',
      bookingStatus: 'CANCELLED',
    }),
    booking({
      id: 'booking-draft',
      bookingStatus: 'PENDING_PAYMENT',
    }),
    booking({
      id: 'booking-package-linked',
      planId: 'plan-1',
      bookingStatus: 'CONFIRMED',
    }),
    booking({
      id: 'booking-no-community',
      location: { fulfilmentType: 'address', addressId: 'addr-1' },
    }),
    booking({
      id: 'booking-outside',
      bookingDate: '2026-10-31',
      schedule: {
        date: '2026-10-31',
        startTime: '10:00',
        endTime: '10:45',
        durationMinutes: 45,
        timezone: 'Asia/Kolkata',
        startAtUtc: 'x',
        endAtUtc: 'y',
      },
    }),
  ];

  const summary = summarizeVendorOperations({
    visits,
    bookings,
    fromDate: '2026-10-29',
    toDate: '2026-10-29',
    timezone: 'Asia/Kolkata',
  });

  it('includes package visits and one-time bookings in the civil date range', () => {
    // visits expected: scheduled, completed, inProgress, missed (4); cancelled separate
    // bookings expected: confirmed, completed, no-community confirmed (3); cancelled separate
    // package-linked and draft excluded; outside-range excluded
    expect(summary.metrics).toEqual({
      expected: 7,
      completed: 2,
      inProgress: 1,
      waiting: 3,
      missed: 1,
      cancelled: 2,
    });
    expect(summary.metrics.expected).toBe(
      summary.metrics.completed
      + summary.metrics.inProgress
      + summary.metrics.waiting
      + summary.metrics.missed,
    );
  });

  it('excludes cancelled from expected and keeps communities[].scheduled as per-community expected', () => {
    const communityScheduled = summary.communities.reduce((sum, row) => sum + row.scheduled, 0);
    expect(communityScheduled).toBeLessThanOrEqual(summary.metrics.expected);
    expect(summary.communities).toEqual([
      expect.objectContaining({
        communityId: 'community-1',
        scheduled: 4,
        completed: 1,
        inProgress: 0,
        waiting: 2,
      }),
      expect.objectContaining({
        communityId: 'community-2',
        scheduled: 2,
        completed: 1,
        inProgress: 1,
        waiting: 0,
      }),
    ]);
  });

  it('groups needsAttention only for waiting > 0 and keeps booking windows unassigned', () => {
    expect(summary.needsAttention).toEqual([
      expect.objectContaining({
        communityId: null,
        visitWindowId: null,
        visitWindowName: null,
        waiting: 1,
      }),
      expect.objectContaining({
        communityId: 'community-1',
        visitWindowId: null,
        visitWindowName: null,
        waiting: 1,
      }),
      expect.objectContaining({
        communityId: 'community-1',
        visitWindowId: 'night',
        visitWindowName: 'Night',
        waiting: 1,
      }),
    ]);
  });

  it('avoids double counting package-linked bookings', () => {
    expect(packageVisitToWorkUnit(visit({ status: PACKAGE_VISIT_STATUS.UNSCHEDULED, schedule: undefined })))
      .toBeNull();
    expect(oneTimeBookingToWorkUnit(booking({ planId: 'plan-1' }))).toBeNull();
    expect(oneTimeBookingToWorkUnit(booking({ bookingStatus: 'PENDING_PAYMENT' }))).toBeNull();
  });

  it('returns the documented empty shape', () => {
    const empty = summarizeVendorOperations({
      visits: [],
      bookings: [],
      fromDate: '2026-10-29',
      toDate: '2026-10-29',
      timezone: 'Asia/Kolkata',
    });
    expect(empty).toEqual({
      fromDate: '2026-10-29',
      toDate: '2026-10-29',
      timezone: 'Asia/Kolkata',
      metrics: {
        expected: 0,
        completed: 0,
        inProgress: 0,
        waiting: 0,
        missed: 0,
        cancelled: 0,
      },
      needsAttention: [],
      communities: [],
    });
  });

  it('matches the shared response schema used by Postman and OpenAPI', () => {
    const parsed = VendorOperationsSummarySchema.safeParse(summary);
    expect(parsed.success).toBe(true);
    const empty = VendorOperationsSummarySchema.safeParse(
      summarizeVendorOperations({
        visits: [],
        bookings: [],
        fromDate: '2026-10-29',
        toDate: '2026-10-29',
        timezone: 'Asia/Kolkata',
      }),
    );
    expect(empty.success).toBe(true);
  });
});
