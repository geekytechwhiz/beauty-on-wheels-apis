import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

import { env } from '../configs/env.config';
import { HoldSnapshot, SlotSnapshot } from '../domain/create-booking';
import { BookingError } from '../errors';
import { authHeaders, requestJson, requireBaseUrl } from './http';

export interface AvailabilityGateway {
  getHold(holdId: string, authorizationHeader?: string): Promise<HoldSnapshot>;
  getSlot(slotId: string, authorizationHeader?: string): Promise<SlotSnapshot>;
  consumeHold(input: { holdId: string; bookingId: string }): Promise<{ bookingId: string; slotId: string }>;
  releaseAllocation(bookingId: string): Promise<void>;
}

export class HttpAvailabilityGateway implements AvailabilityGateway {
  constructor(private readonly lambda: LambdaClient = new LambdaClient({})) {}

  async getHold(holdId: string, authorizationHeader?: string): Promise<HoldSnapshot> {
    const base = requireBaseUrl(env.AVAILABILITY_SERVICE_URL, 'AVAILABILITY_SERVICE_URL');
    try {
      const body = await requestJson(
        `${base}/slot-holds/${encodeURIComponent(holdId)}`,
        { method: 'GET', headers: authHeaders(authorizationHeader) },
      );
      return parseHold(body, holdId);
    } catch (error) {
      if (error instanceof BookingError && error.statusCode === 403) {
        throw new BookingError('HOLD_NOT_OWNED', 'Hold does not belong to the authenticated customer', 403, 'holdId', false);
      }
      if (error instanceof BookingError && error.statusCode === 404) {
        throw new BookingError('HOLD_NOT_FOUND', 'Hold not found', 404, 'holdId', false);
      }
      throw error;
    }
  }

  async getSlot(slotId: string, authorizationHeader?: string): Promise<SlotSnapshot> {
    const base = requireBaseUrl(env.AVAILABILITY_SERVICE_URL, 'AVAILABILITY_SERVICE_URL');
    const body = await requestJson(
      `${base}/slots/${encodeURIComponent(slotId)}`,
      { method: 'GET', headers: authHeaders(authorizationHeader) },
    );
    return parseSlot(body, slotId);
  }

  async consumeHold(input: { holdId: string; bookingId: string }): Promise<{ bookingId: string; slotId: string }> {
    const payload = await this.invoke(env.AVAILABILITY_CONSUME_HOLD_FUNCTION, 'AVAILABILITY_CONSUME_HOLD_FUNCTION', input);
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const allocation = record.allocation && typeof record.allocation === 'object'
      ? record.allocation as Record<string, unknown>
      : record;
    return {
      bookingId: typeof allocation.bookingId === 'string' ? allocation.bookingId : input.bookingId,
      slotId: typeof allocation.slotId === 'string' ? allocation.slotId : input.holdId,
    };
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
      throw mapConsumeFailure(String(body.errorMessage ?? 'Availability request failed'));
    }
    return body;
  }
}

export function parseHold(body: unknown, holdId: string): HoldSnapshot {
  const record = asRecord(body);
  const status = record.status;
  const expiresAt = record.expiresAt;
  const slotId = record.slotId;
  if (typeof status !== 'string' || typeof expiresAt !== 'string' || typeof slotId !== 'string') {
    throw new BookingError('AVAILABILITY_UNAVAILABLE', 'Availability Service returned an incomplete hold', 502);
  }
  return {
    holdId: typeof record.holdId === 'string' ? record.holdId : holdId,
    slotId,
    vendorId: typeof record.vendorId === 'string' ? record.vendorId : '',
    branchId: typeof record.branchId === 'string' ? record.branchId : '',
    ...(typeof record.customerId === 'string' ? { customerId: record.customerId } : {}),
    status,
    expiresAt,
    ...(typeof record.bookingId === 'string' ? { bookingId: record.bookingId } : {}),
  };
}

export function parseSlot(body: unknown, slotId: string): SlotSnapshot {
  const record = asRecord(body);
  return {
    id: typeof record.id === 'string' ? record.id : slotId,
    vendorId: typeof record.vendorId === 'string' ? record.vendorId : '',
    branchId: typeof record.branchId === 'string' ? record.branchId : '',
    date: typeof record.date === 'string' ? record.date : '',
    status: typeof record.status === 'string' ? record.status : '',
    serviceIds: stringList(record.serviceIds),
    vehicleTypeIds: stringList(record.vehicleTypeIds),
  };
}

export function mapConsumeFailure(message: string): BookingError {
  if (/expired/i.test(message)) {
    return new BookingError('HOLD_EXPIRED', 'Hold has expired', 409, 'holdId', false);
  }
  if (/already consumed/i.test(message)) {
    return new BookingError('HOLD_ALREADY_CONSUMED', 'Hold is already consumed', 409, 'holdId', false);
  }
  if (/not found/i.test(message)) {
    return new BookingError('HOLD_NOT_FOUND', message, 404, 'holdId', false);
  }
  return new BookingError('AVAILABILITY_UNAVAILABLE', message, 502, undefined, true);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
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
