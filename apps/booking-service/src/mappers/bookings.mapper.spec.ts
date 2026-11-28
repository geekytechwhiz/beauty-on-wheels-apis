import { Booking } from '../types/api-types';
import { BookingsMapper, bookingCommunityId, bookingWorkGsi1Sk } from './bookings.mapper';

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'bk-1',
    customerId: 'cu-1',
    vendorId: 'vn-1',
    bookingDate: '2026-11-20',
    bookingStatus: 'CONFIRMED',
    ...overrides,
  };
}

describe('bookingWorkGsi1Sk', () => {
  it('indexes one-time bookings by schedule date when present', () => {
    expect(bookingWorkGsi1Sk(booking({
      schedule: {
        date: '2026-11-21',
        startTime: '09:00',
        endTime: '09:45',
        durationMinutes: 45,
        timezone: 'Asia/Kolkata',
        startAtUtc: '2026-11-21T03:30:00.000Z',
        endAtUtc: '2026-11-21T04:15:00.000Z',
      },
    }), 'bk-1')).toBe('BOOKING#2026-11-21#bk-1');
  });

  it('indexes one-time bookings by bookingDate when schedule is absent', () => {
    expect(bookingWorkGsi1Sk(booking(), 'bk-1')).toBe('BOOKING#2026-11-20#bk-1');
  });

  it('does not index package-linked first jobs under bookingDate even when set', () => {
    expect(bookingWorkGsi1Sk(booking({
      planId: 'plan-1',
      bookingDate: '2026-11-28',
    }), 'vi-1')).toBe('BOOKING#UNSCHEDULED#vi-1');
  });
});

describe('BookingsMapper vendor lookup', () => {
  it('writes BOOKING#UNSCHEDULED for package-linked projections', () => {
    const item = BookingsMapper.toVendorLookupDdb(booking({
      planId: 'plan-1',
      id: 'vi-1',
      bookingDate: '2026-11-28',
    }));
    expect(item.GSI1PK).toBe('VENDOR#vn-1');
    expect(item.GSI1SK).toBe('BOOKING#UNSCHEDULED#vi-1');
    expect(item.bookingDate).toBe('2026-11-28');
    expect(item.planId).toBe('plan-1');
  });
});

describe('BookingsMapper.packageVisitToBookingProjection', () => {
  it('maps VISIT# GSI1 rows onto Booking list fields', () => {
    const projected = BookingsMapper.packageVisitToBookingProjection({
      visitId: 'vi-100',
      planId: 'plan-1',
      customerId: 'cu-1',
      vendorId: 'VN-20261121-875151244252786277900782',
      communityId: 'co-1',
      serviceId: 'svc-wash',
      serviceName: 'Exterior Wash',
      status: 'SCHEDULED',
      durationMinutes: 45,
      schedule: {
        date: '2026-11-28',
        startTime: '09:00',
        timezone: 'Asia/Kolkata',
        durationMinutes: 45,
        branchId: 'br-1',
      },
      createdAt: '2026-11-21T10:00:00.000Z',
      updatedAt: '2026-11-27T10:00:00.000Z',
    });

    expect(projected.id).toBe('vi-100');
    expect(projected.vendorId).toBe('VN-20261121-875151244252786277900782');
    expect(projected.planId).toBe('plan-1');
    expect(projected.bookingDate).toBe('2026-11-28');
    expect(projected.bookingStatus).toBe('CONFIRMED');
    expect(projected.serviceIds).toEqual(['svc-wash']);
    expect(projected.location).toEqual({
      fulfilmentType: 'community',
      communityId: 'co-1',
    });
  });
});

describe('BookingsMapper community lookup', () => {
  it('indexes community-fulfilled bookings under COMMUNITY#', () => {
    const communityBooking = booking({
      location: { fulfilmentType: 'community', communityId: 'co-1' },
      schedule: {
        date: '2026-11-21',
        startTime: '09:00',
        endTime: '09:45',
        durationMinutes: 45,
        timezone: 'Asia/Kolkata',
        startAtUtc: '2026-11-21T03:30:00.000Z',
        endAtUtc: '2026-11-21T04:15:00.000Z',
      },
    });
    expect(bookingCommunityId(communityBooking)).toBe('co-1');
    const item = BookingsMapper.toCommunityLookupDdb(communityBooking);
    expect(item.PK).toBe('COMMUNITY#co-1');
    expect(item.GSI1PK).toBe('COMMUNITY#co-1');
    expect(item.GSI1SK).toBe('BOOKING#2026-11-21#bk-1');
    expect(item.entityType).toBe('CommunityBooking');
  });

  it('does not treat address fulfilment as community', () => {
    expect(bookingCommunityId(booking({
      location: { fulfilmentType: 'address', addressId: 'addr-1' },
    }))).toBeUndefined();
  });
});
