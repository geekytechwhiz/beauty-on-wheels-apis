import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

import { env } from '../configs/env.config';
import { SchedulingCrew, SchedulingCrewMember } from '../domain/crew-assignment';
import { BookingError } from '../errors';

export interface SchedulingCrewGateway {
  /** Crews and current staff status for one vendor. The caller has already authorized the vendor. */
  listCrews(vendorId: string): Promise<SchedulingCrew[]>;
}

export class LambdaSchedulingCrewGateway implements SchedulingCrewGateway {
  constructor(private readonly lambda: LambdaClient = new LambdaClient({})) {}

  async listCrews(vendorId: string): Promise<SchedulingCrew[]> {
    const functionName = env.VENDOR_SCHEDULING_CREWS_FUNCTION.trim();
    if (!functionName) {
      throw new BookingError(
        'DEPENDENCY_UNAVAILABLE',
        'VENDOR_SCHEDULING_CREWS_FUNCTION is not configured',
        502,
        undefined,
        true,
      );
    }
    let output;
    try {
      // Lambda invoke, not DynamoDB.
      // eslint-disable-next-line mvrx/no-direct-dynamodb
      output = await this.lambda.send(new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify({ vendorId })),
      }));
    } catch {
      throw new BookingError(
        'DEPENDENCY_UNAVAILABLE',
        'Vendor Service could not be invoked',
        502,
        undefined,
        true,
      );
    }
    if (output.FunctionError) {
      throw new BookingError(
        'DEPENDENCY_UNAVAILABLE',
        'Vendor Service failed while reading crews',
        502,
        undefined,
        true,
      );
    }
    const raw = output.Payload ? Buffer.from(output.Payload).toString('utf8') : '';
    let parsed: unknown = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw new BookingError(
          'DEPENDENCY_UNAVAILABLE',
          'Vendor Service returned an unreadable crew response',
          502,
        );
      }
    }
    return parseSchedulingCrews(parsed);
  }
}

export function parseSchedulingCrews(payload: unknown): SchedulingCrew[] {
  const envelope = asRecord(payload);
  if (envelope.error) {
    throw new BookingError(
      'DEPENDENCY_UNAVAILABLE',
      'Vendor Service could not provide crews',
      502,
      undefined,
      true,
    );
  }
  const body = asRecord(envelope.data ?? payload);
  if (!Array.isArray(body.crews)) {
    throw new BookingError(
      'DEPENDENCY_UNAVAILABLE',
      'Vendor Service did not return crews',
      502,
    );
  }
  return body.crews.map((entry) => parseCrew(entry));
}

function parseCrew(value: unknown): SchedulingCrew {
  const record = asRecord(value);
  const crewId = text(record.crewId);
  const vendorId = text(record.vendorId);
  const name = text(record.name);
  const status = text(record.status);
  if (!crewId || !vendorId || !name || !status || !Array.isArray(record.staff)) {
    throw new BookingError(
      'DEPENDENCY_UNAVAILABLE',
      'Vendor Service returned an incomplete crew',
      502,
    );
  }
  const staff: SchedulingCrewMember[] = record.staff.map((member) => {
    const row = asRecord(member);
    const staffId = text(row.staffId);
    const memberStatus = text(row.status);
    if (!staffId || !memberStatus) {
      throw new BookingError(
        'DEPENDENCY_UNAVAILABLE',
        'Vendor Service returned an incomplete crew member',
        502,
      );
    }
    return {
      staffId,
      status: memberStatus,
      ...(text(row.name) ? { name: text(row.name) } : {}),
    };
  });
  return {
    crewId,
    vendorId,
    name,
    vanLabel: typeof record.vanLabel === 'string' ? record.vanLabel : '',
    status,
    staff,
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BookingError(
      'DEPENDENCY_UNAVAILABLE',
      'Vendor Service returned an unreadable crew response',
      502,
    );
  }
  return value as Record<string, unknown>;
}

let gateway: SchedulingCrewGateway | undefined;

export function getSchedulingCrewGateway(): SchedulingCrewGateway {
  if (!gateway) gateway = new LambdaSchedulingCrewGateway();
  return gateway;
}
