import { randomUUID } from 'crypto';

import {
  BusinessRuleError,
  ConditionalWriteConflictError,
  ForbiddenError,
  LambdaRequest,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { headerValue, requireCustomerId } from '../auth/access';
import { assertProviderAmountMatches, toProviderMinor } from '../domain/money';
import { BookingError } from '../errors';
import { getRazorpayGateway } from '../integrations/razorpay.client';
import {
  BookingsRepository,
  getBookingsRepository,
} from '../repositories/bookings.repository';
import {
  CustomerPlansRepository,
  getCustomerPlansRepository,
} from '../repositories/customer-plans.repository';
import { Booking } from '../types/api-types';
import { CustomerPlanRecord, PlanPaymentRecord } from '../types/customer-plan.types';
import { pathId, resolveProvider, sandboxEnabled } from './payments.service';

const baseLogger = createLogger({ service: 'customer-plan-payments-service', redactPII: true });
const PAYMENT_TTL_MS = 15 * 60 * 1000;

export type CustomerPlanPaymentResponse = Omit<PlanPaymentRecord, 'customerId' | 'idempotencyKey' | 'providerPaymentId'> & {
  sandboxEnabled: boolean;
};

/**
 * Plan payments mirror booking payments (initiate / get / sandbox-complete /
 * provider confirm). The amount always comes from the plan pricing snapshot.
 * A successful payment marks the plan paid, links the first provider-coordinated
 * job, and leaves the plan AWAITING_FIRST_JOB until that job starts.
 * A failed, cancelled, or expired payment leaves the plan PENDING_PAYMENT so
 * the customer can retry with a new Idempotency-Key.
 */
export class CustomerPlanPaymentsService {
  private readonly logger = createChildLogger(baseLogger, { service: 'CustomerPlanPaymentsService' });

  constructor(
    private readonly plans: CustomerPlansRepository = getCustomerPlansRepository(),
    private readonly bookings: BookingsRepository = getBookingsRepository(),
  ) {}

  async initiate(request: LambdaRequest): Promise<CustomerPlanPaymentResponse> {
    const customerId = requireCustomerId(request);
    const planId = pathId(request, 'planId');
    const idempotencyKey = headerValue(request, 'Idempotency-Key');
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw new ValidationError('Idempotency-Key header is required');
    }

    const replay = await this.plans.getIdempotentPayment(customerId, planId, idempotencyKey);
    if (replay) return toResponse(await this.reconcileExpiry(replay));

    const plan = await this.requireOwnedPlan(planId, customerId, 'Not authorized to pay for this plan');
    if (plan.paymentStatus === 'PAID' || plan.status === 'ACTIVE' || plan.status === 'AWAITING_FIRST_JOB') {
      throw new BusinessRuleError('Plan is already paid');
    }
    if (plan.status !== 'PENDING_PAYMENT') {
      throw new BusinessRuleError(`Plan ${planId} is not awaiting payment`);
    }

    const amountMinor = plan.pricingSnapshot.totalMinor;
    const currency = plan.pricingSnapshot.currency.toUpperCase();
    const providerAmountMinor = toProviderMinor(amountMinor, currency);
    const provider = resolveProvider();
    const now = new Date();
    const paymentId = randomUUID();

    let checkoutToken = `sandbox_${randomUUID()}`;
    let checkoutKeyId: string | undefined;
    let providerOrderId: string | undefined;
    if (provider === 'RAZORPAY') {
      const razorpay = getRazorpayGateway();
      const order = await razorpay.createOrder({
        amountPaise: providerAmountMinor,
        currency,
        receipt: paymentId,
        notes: { planId, paymentId, customerId },
      });
      assertProviderAmountMatches(amountMinor, currency, order.amount);
      checkoutToken = order.id;
      providerOrderId = order.id;
      checkoutKeyId = razorpay.publicKeyId();
    }

    const record: PlanPaymentRecord = {
      paymentId,
      planId,
      customerId,
      amountMinor,
      providerAmountMinor,
      currency,
      status: 'PENDING',
      provider,
      checkoutToken,
      ...(checkoutKeyId ? { checkoutKeyId } : {}),
      ...(providerOrderId ? { providerOrderId } : {}),
      idempotencyKey,
      expiresAt: new Date(now.getTime() + PAYMENT_TTL_MS).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    try {
      await this.plans.createPayment(record);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const raced = await this.plans.getIdempotentPayment(customerId, planId, idempotencyKey);
        if (raced) return toResponse(raced);
      }
      throw error;
    }
    this.logger.info({ event: 'plan_payment_initiated', planId, paymentId, provider });
    return toResponse(record);
  }

  async getPayment(request: LambdaRequest): Promise<CustomerPlanPaymentResponse> {
    const customerId = requireCustomerId(request);
    const planId = pathId(request, 'planId');
    const paymentId = pathId(request, 'paymentId');
    const payment = await this.requireOwnedPayment(planId, paymentId, customerId, 'Not authorized to view this payment');
    return toResponse(await this.reconcileExpiry(payment));
  }

  /** Sandbox-only completion; the plan snapshot stays authoritative for the amount. */
  async sandboxComplete(request: LambdaRequest): Promise<CustomerPlanPaymentResponse> {
    if (!sandboxEnabled()) {
      throw new BookingError('SANDBOX_DISABLED', 'Sandbox payment completion is not enabled', 403);
    }
    const customerId = requireCustomerId(request);
    const planId = pathId(request, 'planId');
    const paymentId = pathId(request, 'paymentId');
    const outcome = typeof (request.body as { outcome?: unknown } | null)?.outcome === 'string'
      ? (request.body as { outcome: string }).outcome.trim().toUpperCase()
      : '';
    if (!['SUCCESS', 'FAILURE', 'CANCELLED'].includes(outcome)) {
      throw new ValidationError('outcome must be SUCCESS, FAILURE, or CANCELLED');
    }

    let payment = await this.requireOwnedPayment(planId, paymentId, customerId, 'Not authorized to complete this payment');
    payment = await this.reconcileExpiry(payment);
    if (payment.status === 'PAID') return toResponse(payment);
    if (payment.status !== 'PENDING') {
      throw new BusinessRuleError(`Payment ${paymentId} is ${payment.status}`);
    }
    if (outcome === 'SUCCESS') return toResponse(await this.markPaid(payment));

    const now = new Date().toISOString();
    return toResponse(await this.plans.savePayment({
      ...payment,
      status: outcome === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
      updatedAt: now,
      completedAt: now,
    }));
  }

  /** Razorpay checkout callback: the signature must verify; the plan snapshot amount stays authoritative. */
  async confirmProviderPayment(request: LambdaRequest): Promise<CustomerPlanPaymentResponse> {
    const customerId = requireCustomerId(request);
    const planId = pathId(request, 'planId');
    const paymentId = pathId(request, 'paymentId');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const read = (...keys: string[]) => {
      for (const key of keys) {
        const value = body[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return '';
    };
    const orderId = read('razorpay_order_id', 'orderId');
    const providerPaymentId = read('razorpay_payment_id', 'paymentId');
    const signature = read('razorpay_signature', 'signature');
    if (!orderId || !providerPaymentId || !signature) {
      throw new ValidationError('orderId, paymentId, and signature are required');
    }

    let payment = await this.requireOwnedPayment(planId, paymentId, customerId, 'Not authorized to complete this payment');
    payment = await this.reconcileExpiry(payment);
    if (payment.status === 'PAID') return toResponse(payment);
    if (payment.status !== 'PENDING') throw new BusinessRuleError(`Payment ${paymentId} is ${payment.status}`);
    if (payment.provider !== 'RAZORPAY') throw new BusinessRuleError('Payment is not a Razorpay checkout');
    if (payment.providerOrderId && payment.providerOrderId !== orderId) {
      throw new BusinessRuleError('Razorpay order does not match this payment');
    }
    if (!getRazorpayGateway().verifyPaymentSignature({ orderId, paymentId: providerPaymentId, signature })) {
      throw new BookingError('PAYMENT_SIGNATURE_INVALID', 'Razorpay payment signature verification failed', 400);
    }
    return toResponse(await this.markPaid(payment, providerPaymentId));
  }

  private async markPaid(payment: PlanPaymentRecord, providerPaymentId?: string): Promise<PlanPaymentRecord> {
    const plan = await this.plans.getPlan(payment.planId);
    if (!plan) throw new NotFoundError(`Plan with ID ${payment.planId} not found`);
    if (payment.amountMinor !== plan.pricingSnapshot.totalMinor
      || payment.currency.toUpperCase() !== plan.pricingSnapshot.currency.toUpperCase()) {
      throw new BookingError('PAYMENT_AMOUNT_MISMATCH', 'Payment amount does not match the plan', 409, 'amount');
    }
    await this.activate(plan);
    const now = new Date().toISOString();
    return this.plans.savePayment({
      ...payment,
      status: 'PAID',
      updatedAt: now,
      completedAt: now,
      ...(providerPaymentId ? { providerPaymentId } : {}),
    });
  }

  private async activate(plan: CustomerPlanRecord): Promise<void> {
    if (
      (plan.status === 'ACTIVE' || plan.status === 'AWAITING_FIRST_JOB')
      && plan.paymentStatus === 'PAID'
      && plan.firstJobId
    ) {
      return;
    }
    const now = new Date().toISOString();
    const firstJobId = plan.firstJobId ?? randomUUID();
    if (!plan.firstJobId) {
      await this.bookings.createPackageLinkedBooking(buildFirstJobBooking(plan, firstJobId, now));
    }
    await this.plans.savePlan(
      {
        ...plan,
        status: 'AWAITING_FIRST_JOB',
        paymentStatus: 'PAID',
        firstJobId,
        activatedAt: now,
        updatedAt: now,
        version: plan.version + 1,
        // Billing period start/end stay unset until the first job starts.
        autoRenew: plan.autoRenew === true,
      },
      plan.version,
    );
    this.logger.info({
      event: 'customer_plan_awaiting_first_job',
      planId: plan.planId,
      firstJobId,
      autoRenew: plan.autoRenew === true,
    });
  }

  private async reconcileExpiry(payment: PlanPaymentRecord): Promise<PlanPaymentRecord> {
    if (payment.status !== 'PENDING' || Date.parse(payment.expiresAt) > Date.now()) return payment;
    const now = new Date().toISOString();
    return this.plans.savePayment({ ...payment, status: 'EXPIRED', updatedAt: now, completedAt: now });
  }

  private async requireOwnedPlan(planId: string, customerId: string, forbidden: string): Promise<CustomerPlanRecord> {
    const plan = await this.plans.getPlan(planId);
    if (!plan) throw new NotFoundError(`Plan with ID ${planId} not found`);
    if (plan.customerId !== customerId) throw new ForbiddenError(forbidden);
    return plan;
  }

  private async requireOwnedPayment(
    planId: string,
    paymentId: string,
    customerId: string,
    forbidden: string,
  ): Promise<PlanPaymentRecord> {
    const payment = await this.plans.getPayment(planId, paymentId);
    if (!payment) throw new NotFoundError(`Payment ${paymentId} not found`);
    if (payment.customerId !== customerId) throw new ForbiddenError(forbidden);
    return payment;
  }
}

function toResponse(record: PlanPaymentRecord): CustomerPlanPaymentResponse {
  const { customerId: _customerId, idempotencyKey: _key, providerPaymentId: _providerPaymentId, ...rest } = record;
  return {
    ...rest,
    providerAmountMinor: record.providerAmountMinor,
    sandboxEnabled: sandboxEnabled(),
  };
}

/** First package job: paid/confirmed, no Availability slot; times are provider-coordinated. */
function buildFirstJobBooking(plan: CustomerPlanRecord, bookingId: string, now: string): Booking {
  const offeringId = plan.offeringId || plan.packageId;
  const totalAmount = plan.pricingSnapshot.totalAmount;
  return {
    id: bookingId,
    reference: `BOW-PKG-${bookingId.slice(0, 8).toUpperCase()}`,
    customerId: plan.customerId,
    vendorId: plan.vendorId,
    branchId: plan.branchId,
    vehicleId: plan.vehicleId,
    vehicleDetails: {
      bodyCategory: plan.vehicleType,
      type: plan.vehicleType,
    },
    // Package jobs are not on-demand bookings: no serviceIds or Availability slotId.
    serviceIds: [],
    offeringId,
    offeringVersion: plan.pricingSnapshot.packageVersion,
    planId: plan.planId,
    packageId: plan.packageId,
    service: {
      serviceId: offeringId,
      name: plan.packageName || offeringId,
      offeringId,
      durationMinutes: plan.pricingSnapshot.durationMinutes
        ?? ((plan.includedServices ?? []).reduce(
          (sum, entry) => sum + entry.durationMinutes * entry.visitsPerPeriod,
          0,
        ) || 1),
    },
    bookingDate: now.slice(0, 10),
    slotId: '',
    location: plan.location,
    notes: `Package plan first job (visit preference: ${plan.visitWindow.label})`,
    pricingSnapshot: {
      offeringId,
      offeringVersion: plan.pricingSnapshot.packageVersion ?? 1,
      catalogVersion: plan.pricingSnapshot.packageVersion ?? 1,
      vendorPricingVersion: 0,
      baseAmount: totalAmount,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount,
      totalMinor: plan.pricingSnapshot.totalMinor,
      currency: plan.pricingSnapshot.currency,
    },
    totalAmount,
    paymentStatus: 'PAID',
    bookingStatus: 'CONFIRMED',
    createdAt: now,
    updatedAt: now,
  };
}

let service: CustomerPlanPaymentsService;

export function getCustomerPlanPaymentsService() {
  if (!service) service = new CustomerPlanPaymentsService();
  return service;
}
