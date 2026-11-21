import { Booking } from '../types/api-types';
import { BookingsMapper, bookingWorkGsi1Sk } from './bookings.mapper';

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

  it('does not index package-linked first jobs under activation bookingDate', () => {
    expect(bookingWorkGsi1Sk(booking({ planId: 'plan-1' }), 'vi-1'))
      .toBe('BOOKING#UNSCHEDULED#vi-1');
  });
});

describe('BookingsMapper vendor lookup', () => {
  it('writes BOOKING#UNSCHEDULED for package-linked projections', () => {
    const item = BookingsMapper.toVendorLookupDdb(booking({ planId: 'plan-1', id: 'vi-1' }));
    expect(item.GSI1PK).toBe('VENDOR#vn-1');
    expect(item.GSI1SK).toBe('BOOKING#UNSCHEDULED#vi-1');
    expect(item.bookingDate).toBe('2026-11-20');
    expect(item.planId).toBe('plan-1');
  });
});
