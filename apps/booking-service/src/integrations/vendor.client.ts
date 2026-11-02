import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

import { env } from '../configs/env.config';
import { BranchSnapshot, VendorSnapshot } from '../domain/create-booking';
import { BookingError } from '../errors';

export interface CheckoutEligibility {
  vendor: VendorSnapshot;
  branch?: BranchSnapshot;
}

export interface ReservePlanCapacityInput {
  vendorId: string;
  communityId: string;
  offeringId: string;
  demandQuantity: number;
  planId: string;
}

export interface ReservePlanCapacityResult {
  commitmentId: string;
  quantity: number;
  reservedSoldQuantity: number;
  remainingSoldCapacity: number;
}

export interface VendorGateway {
  /**
   * Vendor checkout eligibility. Pass `branchId` for one-time bookings.
   * Package plans omit `branchId` and validate vendor status only.
   */
  getCheckoutEligibility(vendorId: string, branchId?: string): Promise<CheckoutEligibility>;

  /** Reserves sold visit-slots on a vendor capacity commitment before plan activation. */
  reservePlanCapacity(input: ReservePlanCapacityInput): Promise<ReservePlanCapacityResult>;
}

export interface OperationalAccess {
  role: 'owner' | 'staff' | 'none';
  vendorId?: string;
  staffId?: string;
  active: boolean;
}

export interface OperationalAccessGateway {
  /** Membership for the authenticated user id. The path vendor id is not an input. */
  getOperationalAccess(userId: string): Promise<OperationalAccess>;
}

export class LambdaVendorGateway implements VendorGateway, OperationalAccessGateway {
  constructor(private readonly lambda: LambdaClient = new LambdaClient({})) {}

  async getCheckoutEligibility(vendorId: string, branchId?: string): Promise<CheckoutEligibility> {
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
        Payload: Buffer.from(JSON.stringify({
          vendorId,
          ...(branchId ? { branchId } : {}),
        })),
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

  async reservePlanCapacity(input: ReservePlanCapacityInput): Promise<ReservePlanCapacityResult> {
    const functionName = env.VENDOR_RESERVE_CAPACITY_FUNCTION.trim();
    if (!functionName) {
      throw new BookingError(
        'DEPENDENCY_UNAVAILABLE',
        'VENDOR_RESERVE_CAPACITY_FUNCTION is not configured',
        502,
        undefined,
        true,
      );
    }

    let output;
    try {
      // eslint-disable-next-line mvrx/no-direct-dynamodb
      output = await this.lambda.send(new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify(input)),
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
        'Vendor Service failed while reserving sold capacity',
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
          'Vendor Service returned an unreadable capacity reserve response',
          502,
        );
      }
    }
    return parseReservePlanCapacity(parsed);
  }

  async getOperationalAccess(userId: string): Promise<OperationalAccess> {
    const functionName = env.VENDOR_OPERATIONAL_ACCESS_FUNCTION.trim();
    if (!functionName) {
      throw new BookingError(
        'DEPENDENCY_UNAVAILABLE',
        'VENDOR_OPERATIONAL_ACCESS_FUNCTION is not configured',
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
        Payload: Buffer.from(JSON.stringify({ userId })),
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
        'Vendor Service failed while reading vendor membership',
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
          'Vendor Service returned an unreadable membership response',
          502,
        );
      }
    }
    return parseOperationalAccess(parsed);
  }
}

export function parseCheckoutEligibility(
  payload: unknown,
  vendorId: string,
  branchId?: string,
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
  if (branchId) {
    if (typeof body.branchId !== 'string' || body.branchId !== branchId) {
      throw new BookingError(
        'VENDOR_BRANCH_MISMATCH',
        'Branch does not belong to the selected vendor',
        409,
        'branchId',
        false,
      );
    }
  }
  const resolvedVendorId = typeof body.vendorId === 'string' ? body.vendorId : vendorId;
  return {
    vendor: {
      vendorId: resolvedVendorId,
      status,
      operationalStatus,
      ...(typeof body.onboardingStatus === 'string' ? { onboardingStatus: body.onboardingStatus } : {}),
      ...(typeof body.vendorName === 'string' ? { vendorName: body.vendorName }
        : typeof body.name === 'string' ? { vendorName: body.name } : {}),
      communityIds: Array.isArray(body.communityIds)
        ? body.communityIds.filter((value): value is string => typeof value === 'string')
        : [],
    },
    ...(typeof body.branchId === 'string' && body.branchId.trim()
      ? {
        branch: {
          branchId: body.branchId,
          vendorId: resolvedVendorId,
          ...(typeof body.branchName === 'string' ? { branchName: body.branchName }
            : typeof body.name === 'string' ? { branchName: body.name } : {}),
        },
      }
      : {}),
  };
}

export function parseOperationalAccess(payload: unknown): OperationalAccess {
  const envelope = asRecord(payload);
  if (envelope.error) {
    throw mapVendorFailure(envelope.error);
  }
  const body = asRecord(envelope.data ?? payload);
  const role = body.role;
  if (role !== 'owner' && role !== 'staff' && role !== 'none') {
    throw new BookingError(
      'DEPENDENCY_UNAVAILABLE',
      'Vendor Service did not return membership',
      502,
    );
  }
  return {
    role,
    active: body.active === true,
    ...(typeof body.vendorId === 'string' && body.vendorId.trim() ? { vendorId: body.vendorId.trim() } : {}),
    ...(typeof body.staffId === 'string' && body.staffId.trim() ? { staffId: body.staffId.trim() } : {}),
  };
}

export function parseReservePlanCapacity(payload: unknown): ReservePlanCapacityResult {
  const envelope = asRecord(payload);
  if (envelope.error) {
    throw mapVendorCapacityFailure(envelope.error);
  }
  const body = asRecord(envelope.data ?? payload);
  const commitmentId = body.commitmentId;
  const quantity = body.quantity;
  const reservedSoldQuantity = body.reservedSoldQuantity;
  const remainingSoldCapacity = body.remainingSoldCapacity;
  if (
    typeof commitmentId !== 'string'
    || typeof quantity !== 'number'
    || typeof reservedSoldQuantity !== 'number'
    || typeof remainingSoldCapacity !== 'number'
  ) {
    throw new BookingError(
      'DEPENDENCY_UNAVAILABLE',
      'Vendor Service did not return a capacity reservation',
      502,
    );
  }
  return {
    commitmentId,
    quantity,
    reservedSoldQuantity,
    remainingSoldCapacity,
  };
}

export function mapVendorCapacityFailure(error: unknown): BookingError {
  const record = asRecord(error);
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string' && record.message.trim()
    ? record.message.trim()
    : 'Capacity is not available for this plan';
  const statusCode = typeof record.statusCode === 'number' ? record.statusCode : 502;
  if (code === 'CAPACITY_UNAVAILABLE' || (statusCode === 409 && code !== 'VENDOR_BRANCH_MISMATCH')) {
    return new BookingError('CAPACITY_UNAVAILABLE', message, 409, undefined, false);
  }
  if (code === 'VALIDATION_ERROR' || statusCode === 400) {
    return new BookingError('VALIDATION_ERROR', message, 400);
  }
  return new BookingError(
    'DEPENDENCY_UNAVAILABLE',
    'Vendor Service could not reserve sold capacity',
    502,
    undefined,
    true,
  );
}

export function mapVendorFailure(error: unknown): BookingError {
  const record = asRecord(error);
  const code = typeof record.code === 'string' ? record.code : '';
  const statusCode = typeof record.statusCode === 'number' ? record.statusCode : 502;
  if (code === 'CAPACITY_UNAVAILABLE') {
    return mapVendorCapacityFailure(error);
  }
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

export function getOperationalAccessGateway(): OperationalAccessGateway {
  const current = getVendorGateway();
  if ('getOperationalAccess' in current) return current as OperationalAccessGateway;
  throw new BookingError(
    'DEPENDENCY_UNAVAILABLE',
    'Vendor membership lookup is not configured',
    502,
    undefined,
    true,
  );
}
