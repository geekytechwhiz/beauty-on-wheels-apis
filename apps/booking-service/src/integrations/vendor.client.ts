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
  /** Plan visit-window clock preference; commitment daily window must overlap. */
  dailyWindow?: { startTime: string; endTime: string };
  /** Full weekday names (MONDAY…SUNDAY) from the plan preference. */
  preferredDays?: Array<
    'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'
  >;
}

export interface HoldPlanCapacityInput extends ReservePlanCapacityInput {
  paymentId: string;
  expiresAt: string;
}

export interface ConfirmPlanCapacityInput extends ReservePlanCapacityInput {
  paymentId?: string;
}

export interface ReservePlanCapacityResult {
  commitmentId: string;
  quantity: number;
  reservedSoldQuantity: number;
  remainingSoldCapacity: number;
  claimedPeriodQuantity?: number;
  periodSupply?: number;
}

export interface ReserveVisitCapacityInput {
  vendorId: string;
  communityId: string;
  offeringId: string;
  planId: string;
  visitId: string;
  date: string;
  startTime: string;
  endTime: string;
  demandQuantity: number;
}

export interface ReserveVisitCapacityResult {
  commitmentId: string;
  date: string;
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

  /** Holds period eligibility while a checkout payment is pending. */
  holdPlanCapacity(input: HoldPlanCapacityInput): Promise<ReservePlanCapacityResult>;

  /** Converts a valid checkout hold to a durable period claim. */
  confirmPlanCapacity(input: ConfirmPlanCapacityInput): Promise<ReservePlanCapacityResult>;

  /** Releases a pending hold or period claim for a cancelled/refunded plan. */
  releasePlanCapacity(planId: string): Promise<void>;

  /** Legacy direct sold reservation. New checkouts must use hold + confirm. */
  reservePlanCapacity(input: ReservePlanCapacityInput): Promise<ReservePlanCapacityResult>;

  /** Debits commitment day capacity when a package visit is scheduled. */
  reserveVisitCapacity(input: ReserveVisitCapacityInput): Promise<ReserveVisitCapacityResult>;

  /** Releases a visit day debit (cancel / reschedule-away). */
  releaseVisitCapacity(visitId: string): Promise<void>;
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
    return parseReservePlanCapacity(await this.invokeCapacity(
      env.VENDOR_RESERVE_CAPACITY_FUNCTION.trim(),
      input,
      'reserve sold capacity',
      'VENDOR_RESERVE_CAPACITY_FUNCTION',
    ));
  }

  async holdPlanCapacity(input: HoldPlanCapacityInput): Promise<ReservePlanCapacityResult> {
    return parseReservePlanCapacity(await this.invokeCapacity(
      env.VENDOR_HOLD_CAPACITY_FUNCTION.trim(),
      input,
      'hold capacity',
      'VENDOR_HOLD_CAPACITY_FUNCTION',
    ));
  }

  async confirmPlanCapacity(input: ConfirmPlanCapacityInput): Promise<ReservePlanCapacityResult> {
    return parseReservePlanCapacity(await this.invokeCapacity(
      env.VENDOR_CONFIRM_CAPACITY_FUNCTION.trim(),
      input,
      'confirm capacity',
      'VENDOR_CONFIRM_CAPACITY_FUNCTION',
    ));
  }

  async releasePlanCapacity(planId: string): Promise<void> {
    const payload = await this.invokeCapacity(
      env.VENDOR_RELEASE_CAPACITY_FUNCTION.trim(),
      { planId },
      'release capacity',
      'VENDOR_RELEASE_CAPACITY_FUNCTION',
    );
    const envelope = asRecord(payload);
    if (envelope.error) throw mapVendorCapacityFailure(envelope.error);
  }

  async reserveVisitCapacity(input: ReserveVisitCapacityInput): Promise<ReserveVisitCapacityResult> {
    return parseReserveVisitCapacity(await this.invokeCapacity(
      env.VENDOR_RESERVE_VISIT_CAPACITY_FUNCTION.trim(),
      input,
      'reserve visit capacity',
      'VENDOR_RESERVE_VISIT_CAPACITY_FUNCTION',
    ));
  }

  async releaseVisitCapacity(visitId: string): Promise<void> {
    const payload = await this.invokeCapacity(
      env.VENDOR_RELEASE_VISIT_CAPACITY_FUNCTION.trim(),
      { visitId },
      'release visit capacity',
      'VENDOR_RELEASE_VISIT_CAPACITY_FUNCTION',
    );
    const envelope = asRecord(payload);
    if (envelope.error) throw mapVendorCapacityFailure(envelope.error);
  }

  private async invokeCapacity(
    functionName: string,
    input: object,
    action: string,
    configName: string,
  ): Promise<unknown> {
    if (!functionName) {
      throw new BookingError(
        'DEPENDENCY_UNAVAILABLE',
        `${configName} is not configured`,
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
        `Vendor Service could not ${action}`,
        502,
        undefined,
        true,
      );
    }

    if (output.FunctionError) {
      throw new BookingError(
        'DEPENDENCY_UNAVAILABLE',
        `Vendor Service failed while attempting to ${action}`,
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
          `Vendor Service returned an unreadable capacity ${action} response`,
          502,
        );
      }
    }
    return parsed;
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
    ...(typeof body.claimedPeriodQuantity === 'number'
      ? { claimedPeriodQuantity: body.claimedPeriodQuantity }
      : {}),
    ...(typeof body.periodSupply === 'number' ? { periodSupply: body.periodSupply } : {}),
  };
}

export function parseReserveVisitCapacity(payload: unknown): ReserveVisitCapacityResult {
  const envelope = asRecord(payload);
  if (envelope.error) {
    throw mapVendorCapacityFailure(envelope.error);
  }
  const body = asRecord(envelope.data ?? payload);
  const commitmentId = body.commitmentId;
  const date = body.date;
  const quantity = body.quantity;
  const reservedSoldQuantity = body.reservedSoldQuantity;
  const remainingSoldCapacity = body.remainingSoldCapacity;
  if (
    typeof commitmentId !== 'string'
    || typeof date !== 'string'
    || typeof quantity !== 'number'
    || typeof reservedSoldQuantity !== 'number'
    || typeof remainingSoldCapacity !== 'number'
  ) {
    throw new BookingError(
      'DEPENDENCY_UNAVAILABLE',
      'Vendor Service did not return a visit capacity reservation',
      502,
    );
  }
  return {
    commitmentId,
    date,
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
