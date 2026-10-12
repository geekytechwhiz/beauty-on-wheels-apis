import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

import { env } from '../configs/env.config';
import { BranchSnapshot, VendorSnapshot } from '../domain/create-booking';
import { BookingError } from '../errors';

export interface CheckoutEligibility {
  vendor: VendorSnapshot;
  branch: BranchSnapshot;
}

export interface VendorGateway {
  getCheckoutEligibility(vendorId: string, branchId: string): Promise<CheckoutEligibility>;
}

export class LambdaVendorGateway implements VendorGateway {
  constructor(private readonly lambda: LambdaClient = new LambdaClient({})) {}

  async getCheckoutEligibility(vendorId: string, branchId: string): Promise<CheckoutEligibility> {
    const functionName = env.VENDOR_CHECKOUT_ELIGIBILITY_FUNCTION.trim();
    if (!functionName) {
      throw new BookingError(
        'DEPENDENCY_UNAVAILABLE',
        'VENDOR_CHECKOUT_ELIGIBILITY_FUNCTION is not configured',
        502,
        undefined,
        true,
      );
    }

    let output;
    try {
      // Lambda invoke, not DynamoDB. The shared lint rule treats every client.send() call as a table access.
      // eslint-disable-next-line mvrx/no-direct-dynamodb
      output = await this.lambda.send(new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify({ vendorId, branchId })),
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
        'Vendor Service failed while reading checkout eligibility',
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
          'Vendor Service returned an unreadable eligibility response',
          502,
        );
      }
    }
    return parseCheckoutEligibility(parsed, vendorId, branchId);
  }
}

export function parseCheckoutEligibility(
  payload: unknown,
  vendorId: string,
  branchId: string,
): CheckoutEligibility {
  const envelope = asRecord(payload);
  if (envelope.error) {
    throw mapVendorFailure(envelope.error);
  }
  const body = asRecord(envelope.data ?? payload);
  const status = body.status;
  const operationalStatus = body.operationalStatus;
  if (typeof status !== 'string' || typeof operationalStatus !== 'string') {
    throw new BookingError(
      'DEPENDENCY_UNAVAILABLE',
      'Vendor Service did not return vendor eligibility',
      502,
    );
  }
  if (typeof body.branchId !== 'string' || body.branchId !== branchId) {
    throw new BookingError(
      'VENDOR_BRANCH_MISMATCH',
      'Branch does not belong to the selected vendor',
      409,
      'branchId',
      false,
    );
  }
  const resolvedVendorId = typeof body.vendorId === 'string' ? body.vendorId : vendorId;
  return {
    vendor: {
      vendorId: resolvedVendorId,
      status,
      operationalStatus,
      ...(typeof body.onboardingStatus === 'string' ? { onboardingStatus: body.onboardingStatus } : {}),
      communityIds: Array.isArray(body.communityIds)
        ? body.communityIds.filter((value): value is string => typeof value === 'string')
        : [],
    },
    branch: {
      branchId: body.branchId,
      vendorId: resolvedVendorId,
    },
  };
}

export function mapVendorFailure(error: unknown): BookingError {
  const record = asRecord(error);
  const code = typeof record.code === 'string' ? record.code : '';
  const statusCode = typeof record.statusCode === 'number' ? record.statusCode : 502;
  if (code === 'VENDOR_BRANCH_MISMATCH' || statusCode === 409) {
    return new BookingError(
      'VENDOR_BRANCH_MISMATCH',
      'Branch does not belong to the selected vendor',
      409,
      'branchId',
      false,
    );
  }
  if (code === 'VENDOR_NOT_FOUND' || statusCode === 404) {
    return new BookingError('VENDOR_NOT_FOUND', 'Vendor not found', 404, 'vendorId', false);
  }
  return new BookingError(
    'DEPENDENCY_UNAVAILABLE',
    'Vendor Service could not provide checkout eligibility',
    502,
    undefined,
    true,
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BookingError(
      'DEPENDENCY_UNAVAILABLE',
      'Vendor Service returned an unreadable eligibility response',
      502,
    );
  }
  return value as Record<string, unknown>;
}

let gateway: VendorGateway | undefined;

export function getVendorGateway(): VendorGateway {
  if (!gateway) {
    gateway = new LambdaVendorGateway();
  }
  return gateway;
}
