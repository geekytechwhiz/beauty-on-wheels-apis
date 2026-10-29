jest.mock('../configs/env.config', () => ({
  env: {
    AVAILABILITY_BASE_URL: '',
    AVAILABILITY_RESERVE_BOOKING_FUNCTION: 'availability-reserve',
    AVAILABILITY_RELEASE_ALLOCATION_FUNCTION: 'availability-release',
  },
}));

import { LambdaClient } from '@aws-sdk/client-lambda';

import { HttpAvailabilityGateway, mapReservationFailure, parseReservation } from './availability.client';

describe('availability gateway', () => {
  const input = {
    bookingId: 'booking-1',
    customerId: 'customer-1',
    vendorId: 'vendor-1',
    branchId: 'branch-1',
    offeringId: 'svc_polish',
    vehicleType: 'HATCHBACK',
    date: '2026-10-21',
    startTime: '09:00',
    timezone: 'Asia/Kolkata',
    durationMinutes: 45,
    authorizationHeader: 'Bearer secret-token',
  };

  it('invokes atomic reservation and does not forward the caller token', async () => {
    const send = jest.fn().mockResolvedValue({
      Payload: Buffer.from(JSON.stringify({
        slotId: 'slot_0900',
        date: '2026-10-21',
        startTime: '09:00',
        endTime: '09:45',
        timezone: 'Asia/Kolkata',
        durationMinutes: 45,
      })),
    });
    const gateway = new HttpAvailabilityGateway({ send } as unknown as LambdaClient);
    await expect(gateway.reserveBooking(input)).resolves.toEqual({
      slotId: 'slot_0900',
      date: '2026-10-21',
      startTime: '09:00',
      endTime: '09:45',
      timezone: 'Asia/Kolkata',
      durationMinutes: 45,
    });
    const payload = JSON.parse(Buffer.from(send.mock.calls[0][0].input.Payload).toString()) as Record<string, unknown>;
    expect(send.mock.calls[0][0].input.FunctionName).toBe('availability-reserve');
    expect(payload).toMatchObject({
      bookingId: 'booking-1',
      offeringId: 'svc_polish',
      durationMinutes: 45,
      startTime: '09:00',
    });
    expect(payload.authorizationHeader).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('secret-token');
  });

  it('forwards package visit correlation fields in the Lambda payload', async () => {
    const send = jest.fn().mockResolvedValue({
      Payload: Buffer.from(JSON.stringify({
        slotId: 'slot_0900',
        endTime: '09:45',
      })),
    });
    const gateway = new HttpAvailabilityGateway({ send } as unknown as LambdaClient);
    await gateway.reserveBooking({
      ...input,
      packageVisitId: 'visit-1',
      planId: 'plan-1',
    });
    const payload = JSON.parse(Buffer.from(send.mock.calls[0][0].input.Payload).toString()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      bookingId: 'booking-1',
      packageVisitId: 'visit-1',
      planId: 'plan-1',
    });
  });

  it('maps released and capacity failures to the booking slot conflict', () => {
    expect(mapReservationFailure('Slot capacity has been exceeded').statusCode).toBe(409);
    expect(mapReservationFailure('Booking capacity reservation was released').code).toBe('SLOT_UNAVAILABLE');
    expect(parseReservation({
      slotId: 'slot_0900',
      endTime: '10:30',
      durationMinutes: 90,
    }, input).endTime).toBe('10:30');
  });
});
