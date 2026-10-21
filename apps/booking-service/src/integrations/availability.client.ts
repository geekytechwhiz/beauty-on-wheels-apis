import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

import { env } from '../configs/env.config';
import { ReservationSnapshot } from '../domain/create-booking';
import { BookingError } from '../errors';

export interface ReserveBookingInput {
  bookingId: string;
  customerId: string;
  vendorId: string;
  branchId: string;
  offeringId: string;
  vehicleType: string;
  date: string;
  startTime: string;
  timezone: string;
  durationMinutes: number;
  authorizationHeader?: string;
}

export interface AvailabilityGateway {
  reserveBooking(input: ReserveBookingInput): Promise<ReservationSnapshot>;
  releaseAllocation(bookingId: string): Promise<void>;
}

export class HttpAvailabilityGateway implements AvailabilityGateway {
  constructor(private readonly lambda: LambdaClient = new LambdaClient({})) {}

  async reserveBooking(input: ReserveBookingInput): Promise<ReservationSnapshot> {
    try {
      const body = await this.invoke(
        env.AVAILABILITY_RESERVE_BOOKING_FUNCTION,
        'AVAILABILITY_RESERVE_BOOKING_FUNCTION',
        {
          bookingId: input.bookingId,
          customerId: input.customerId,
          vendorId: input.vendorId,
          branchId: input.branchId,
          offeringId: input.offeringId,
          vehicleType: input.vehicleType,
          date: input.date,
          startTime: input.startTime,
          timezone: input.timezone,
          durationMinutes: input.durationMinutes,
        },
      );
      return parseReservation(body, input);
    } catch (error) {
      throw toAvailabilityError(error);
    }
  }

  async releaseAllocation(bookingId: string): Promise<void> {
    try {
      await this.invoke(
        env.AVAILABILITY_RELEASE_ALLOCATION_FUNCTION,
        'AVAILABILITY_RELEASE_ALLOCATION_FUNCTION',
        { bookingId },
      );
    } catch (error) {
      if (error instanceof BookingError && error.statusCode === 404) {
        return;
      }
      throw error;
    }
  }

  private async invoke(functionName: string, configName: string, payload: unknown): Promise<unknown> {
    const name = functionName.trim();
    if (!name) {
      throw new BookingError('AVAILABILITY_UNAVAILABLE', `${configName} is not configured`, 502, undefined, true);
    }
    let output;
    try {
      // Lambda invoke, not DynamoDB. The shared lint rule treats every client.send() call as a table access.
      // eslint-disable-next-line mvrx/no-direct-dynamodb
      output = await this.lambda.send(new InvokeCommand({
        FunctionName: name,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify(payload)),
      }));
    } catch {
      throw new BookingError(
        'AVAILABILITY_UNAVAILABLE',
        'Availability Service could not be invoked',
        502,
        undefined,
        true,
      );
    }
    const raw = output.Payload ? Buffer.from(output.Payload).toString('utf8') : '';
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    if (output.FunctionError) {
      throw mapReservationFailure(String(body.errorMessage ?? 'Availability request failed'));
    }
    return body;
  }

}

export function parseReservation(body: unknown, input: { date: string; startTime: string; timezone: string; durationMinutes: number }): ReservationSnapshot {
  const envelope = asRecord(body);
  const record = envelope.data && typeof envelope.data === 'object' ? asRecord(envelope.data) : envelope;
  const slotId = record.slotId;
  const endTime = record.endTime;
  if (typeof slotId !== 'string' || typeof endTime !== 'string') {
    throw new BookingError('AVAILABILITY_UNAVAILABLE', 'Availability Service returned an incomplete reservation', 502);
  }
  return {
    slotId,
    date: typeof record.date === 'string' ? record.date : input.date,
    startTime: typeof record.startTime === 'string' ? record.startTime : input.startTime,
    endTime,
    timezone: typeof record.timezone === 'string' ? record.timezone : input.timezone,
    durationMinutes: typeof record.durationMinutes === 'number' ? record.durationMinutes : input.durationMinutes,
  };
}

export function mapReservationFailure(message: string): BookingError {
  if (/capacity|compatible capacity|unavailable|not available|closed|passed|not found|released/i.test(message)) {
    return new BookingError('SLOT_UNAVAILABLE', message, 409, 'schedule.startTime', false);
  }
  return new BookingError('AVAILABILITY_UNAVAILABLE', message, 502, undefined, true);
}

function toAvailabilityError(error: unknown): BookingError {
  if (!(error instanceof BookingError)) {
    return new BookingError(
      'AVAILABILITY_UNAVAILABLE',
      'Availability Service could not be reached',
      502,
      undefined,
      true,
    );
  }
  if (error.code === 'SLOT_UNAVAILABLE' || error.code === 'AVAILABILITY_UNAVAILABLE') {
    return error;
  }
  if (error.statusCode === 409 || error.statusCode === 404) {
    return mapReservationFailure(error.message);
  }
  return new BookingError(
    'AVAILABILITY_UNAVAILABLE',
    error.message || 'Availability Service could not reserve the slot',
    error.statusCode >= 500 ? 502 : error.statusCode,
    undefined,
    error.statusCode >= 500,
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new BookingError('AVAILABILITY_UNAVAILABLE', 'Availability Service returned an unreadable response', 502);
  }
  return value as Record<string, unknown>;
}

let gateway: AvailabilityGateway | undefined;

export function getAvailabilityGateway(): AvailabilityGateway {
  if (!gateway) {
    gateway = new HttpAvailabilityGateway();
  }
  return gateway;
}
