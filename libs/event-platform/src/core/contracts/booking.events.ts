import { z } from 'zod';

import { defineEvent } from '../schema/define-event';
import { registerEventDefinition } from '../../governance/event-registry';

export const BOOKING_CONFIRMED_EVENT_TYPE = 'Booking.Confirmed' as const;
export const BOOKING_CONFIRMED_EVENT_VERSION = '1.0.0' as const;
export const BOOKING_CONFIRMED_EVENT_SOURCE = 'booking-service' as const;

/** Middleware / logs `operation` — must end with `.processed`. */
export const BOOKING_EVENT_OPERATIONS = {
  EMAIL_CONSUME: 'email.booking.confirmed.processed',
} as const;

export const BookingConfirmedPayloadSchema = z
  .object({
    bookingId: z.string().min(1),
    customerId: z.string().min(1),
    vendorId: z.string().min(1),
    customerEmail: z.string().email(),
    bookingDate: z.string().min(1),
    slotId: z.string().min(1),
    bookingStatus: z.literal('confirmed'),
    totalAmount: z.number().optional(),
    customerName: z.string().min(1).optional(),
    vendorName: z.string().min(1).optional(),
  })
  .strict();

export type BookingConfirmedPayload = z.infer<typeof BookingConfirmedPayloadSchema>;

export const BookingConfirmedEvent = defineEvent(BookingConfirmedPayloadSchema, {
  eventType: BOOKING_CONFIRMED_EVENT_TYPE,
  eventVersion: BOOKING_CONFIRMED_EVENT_VERSION,
  source: BOOKING_CONFIRMED_EVENT_SOURCE,
  transport: 'eventbridge',
});

export function bookingConfirmedIdempotencyKey(bookingId: string): string {
  return `${BOOKING_CONFIRMED_EVENT_TYPE}:${bookingId}`;
}

registerEventDefinition({
  eventType: BOOKING_CONFIRMED_EVENT_TYPE,
  eventVersion: BOOKING_CONFIRMED_EVENT_VERSION,
  source: BOOKING_CONFIRMED_EVENT_SOURCE,
  transport: 'eventbridge',
  classification: 'domain',
  ownerTeam: 'booking',
  compatibility: 'strict',
});
