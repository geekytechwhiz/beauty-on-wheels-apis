import {
  BookingConfirmedEvent,
  BOOKING_CONFIRMED_EVENT_TYPE,
  BOOKING_CONFIRMED_EVENT_VERSION,
  BOOKING_CONFIRMED_EVENT_SOURCE,
  bookingConfirmedIdempotencyKey,
} from './booking.events';
import { getRegisteredEventDefinition } from '../../governance/event-registry';
import { getSchemaMeta } from '../schema/schema-meta';

describe('BookingConfirmedEvent', () => {
  it('is registered with stable type, version, and source', () => {
    const meta = getSchemaMeta(BookingConfirmedEvent);
    expect(meta.eventType).toBe(BOOKING_CONFIRMED_EVENT_TYPE);
    expect(meta.eventVersion).toBe(BOOKING_CONFIRMED_EVENT_VERSION);
    expect(meta.source).toBe(BOOKING_CONFIRMED_EVENT_SOURCE);
    expect(meta.transport).toBe('eventbridge');

    const registered = getRegisteredEventDefinition(BOOKING_CONFIRMED_EVENT_TYPE);
    expect(registered?.eventVersion).toBe(BOOKING_CONFIRMED_EVENT_VERSION);
    expect(registered?.classification).toBe('domain');
  });

  it('accepts the identifiers required by email delivery', () => {
    const parsed = BookingConfirmedEvent.parse({
      bookingId: 'bkg-1',
      customerId: 'cust-1',
      vendorId: 'vendor-1',
      customerEmail: 'customer@example.com',
      bookingDate: '2026-09-20',
      slotId: 'slot-1',
      bookingStatus: 'confirmed',
    });

    expect(parsed.bookingId).toBe('bkg-1');
    expect(parsed.customerEmail).toBe('customer@example.com');
    expect(parsed.bookingStatus).toBe('confirmed');
  });

  it('rejects an invalid customer email', () => {
    expect(() =>
      BookingConfirmedEvent.parse({
        bookingId: 'bkg-1',
        customerId: 'cust-1',
        vendorId: 'vendor-1',
        customerEmail: 'not-an-email',
        bookingDate: '2026-09-20',
        slotId: 'slot-1',
        bookingStatus: 'confirmed',
      }),
    ).toThrow();
  });

  it('does not accept a template identifier from producers', () => {
    const parsed = BookingConfirmedEvent.safeParse({
      bookingId: 'bkg-1',
      customerId: 'cust-1',
      vendorId: 'vendor-1',
      customerEmail: 'customer@example.com',
      bookingDate: '2026-09-20',
      slotId: 'slot-1',
      bookingStatus: 'confirmed',
      templateId: 'BookingConfirmed',
    });

    expect(parsed.success).toBe(false);
  });

  it('builds a stable business idempotency key', () => {
    expect(bookingConfirmedIdempotencyKey('bkg-1')).toBe('Booking.Confirmed:bkg-1');
  });
});
