import {
  planBookingUnscheduledSk,
  planVisitGsi3,
} from './backfill-vendor-work-indexes';

describe('backfill-vendor-work-indexes planners', () => {
  it('plans GSI3 for scheduled package visits missing the index', () => {
    expect(planVisitGsi3({
      entityType: 'PackageVisit',
      vendorId: 'vn-1',
      visitId: 'vi-1',
      status: 'SCHEDULED',
      schedule: { date: '2026-11-20', startTime: '09:00' },
    })).toEqual({
      GSI3PK: 'VENDOR#vn-1#DATE#2026-11-20',
      GSI3SK: 'VISIT#09:00#vi-1',
    });
  });

  it('skips unscheduled visits and already-correct GSI3', () => {
    expect(planVisitGsi3({
      entityType: 'PackageVisit',
      vendorId: 'vn-1',
      visitId: 'vi-1',
      status: 'UNSCHEDULED',
      schedule: { date: '2026-11-20', startTime: '09:00' },
    })).toBeNull();
    expect(planVisitGsi3({
      entityType: 'PackageVisit',
      vendorId: 'vn-1',
      visitId: 'vi-1',
      status: 'SCHEDULED',
      schedule: { date: '2026-11-20', startTime: '09:00' },
      GSI3PK: 'VENDOR#vn-1#DATE#2026-11-20',
      GSI3SK: 'VISIT#09:00#vi-1',
    })).toBeNull();
  });

  it('rewrites package-linked activation-date booking sort keys', () => {
    expect(planBookingUnscheduledSk({
      entityType: 'VendorBooking',
      id: 'vi-1',
      planId: 'plan-1',
      GSI1SK: 'BOOKING#2026-11-20#vi-1',
    })).toBe('BOOKING#UNSCHEDULED#vi-1');
  });

  it('leaves one-time and already-unscheduled package bookings alone', () => {
    expect(planBookingUnscheduledSk({
      entityType: 'VendorBooking',
      id: 'bk-1',
      GSI1SK: 'BOOKING#2026-11-20#bk-1',
    })).toBeNull();
    expect(planBookingUnscheduledSk({
      entityType: 'VendorBooking',
      id: 'vi-1',
      planId: 'plan-1',
      GSI1SK: 'BOOKING#UNSCHEDULED#vi-1',
    })).toBeNull();
  });
});
