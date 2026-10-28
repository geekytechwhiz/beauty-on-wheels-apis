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
import { env } from '../configs/env.config';
import { payableAmount } from '../domain/create-booking';
import { assertProviderAmountMatches, toProviderMinor } from '../domain/money';
import { BookingError } from '../errors';
import { getRazorpayGateway } from '../integrations/razorpay.client';
import {
  getPaymentsRepository,
  PaymentsRepository,
} from '../repositories/payments.repository';
import {
  getBookingsRepository,
  BookingsRepository,
} from '../repositories/bookings.repository';
import { getBookingsService } from './bookings.service';
import { CustomerPaymentRecord, PaymentProvider } from '../types/payment.types';

const baseLogger = createChildLogger(createLogger({ service: 'payments-service', redactPII: true }), {
  service: 'PaymentsService',
});
const PAYMENT_TTL_MS = 15 * 60 * 1000;

export type CustomerPaymentResponse = {
  paymentId: string;
  bookingId: string;
  amountMinor: number;
  providerAmountMinor: number;
  currency: string;
  status: CustomerPaymentRecord['status'];
  provider: PaymentProvider;
  checkoutToken: string;
  checkoutKeyId?: string;
  providerOrderId?: string;
  expiresAt: string;
  sandboxEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export class PaymentsService {
  private readonly logger = baseLogger;

  constructor(
    private readonly payments: PaymentsRepository = getPaymentsRepository(),
    private readonly bookings: BookingsRepository = getBookingsRepository(),
  ) {}

  async initiate(request: LambdaRequest): Promise<CustomerPaymentResponse> {
    const customerId = requireCustomerId(request);
    const bookingId = pathId(request, 'bookingId');
    const idempotencyKey = headerValue(request, 'Idempotency-Key')
      ?? (typeof (request.body as { idempotencyKey?: unknown } | null)?.idempotencyKey === 'string'
        ? (request.body as { idempotencyKey: string }).idempotencyKey.trim()
        : '');
    if (!idempotencyKey) {
      throw new ValidationError('Idempotency-Key header is required');
    }

    const existing = await this.payments.getIdempotentPayment(customerId, bookingId, idempotencyKey);
    if (existing) return toResponse(existing);

    const booking = await this.bookings.getBookingById(bookingId);
    if (!booking) throw new NotFoundError(`Booking with ID ${bookingId} not found`);
    if (booking.customerId !== customerId) {
      throw new ForbiddenError('Not authorized to pay for this booking');
    }
    if (booking.paymentStatus === 'PAID' || booking.bookingStatus === 'CONFIRMED') {
      throw new BusinessRuleError('Booking is already paid');
    }
    if (!['PENDING_PAYMENT', 'PENDING', 'CREATED'].includes(booking.bookingStatus ?? '')) {
      throw new BusinessRuleError(`Booking ${bookingId} is not awaiting payment`);
    }
    if (booking.paymentStatus && booking.paymentStatus !== 'PENDING') {
      throw new BusinessRuleError(`Booking ${bookingId} payment status is ${booking.paymentStatus}`);
    }

    const amountMinor = booking.pricingSnapshot?.totalMinor ?? payableAmount(booking);
    const currency = (booking.pricingSnapshot?.currency ?? 'INR').toUpperCase();
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
        notes: {
          bookingId,
          paymentId,
          customerId,
        },
      });
      assertProviderAmountMatches(amountMinor, currency, order.amount);
      checkoutToken = order.id;
      providerOrderId = order.id;
      checkoutKeyId = razorpay.publicKeyId();
    }

    const record: CustomerPaymentRecord = {
      paymentId,
      bookingId,
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
      await this.payments.createPayment(record);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const replay = await this.payments.getIdempotentPayment(customerId, bookingId, idempotencyKey);
        if (replay) return toResponse(replay);
      }
      throw error;
    }

    this.logger.info({ event: 'payment_initiated', bookingId, paymentId: record.paymentId, provider });
    return toResponse(record);
  }

  async getPayment(request: LambdaRequest): Promise<CustomerPaymentResponse> {
    const customerId = requireCustomerId(request);
    const bookingId = pathId(request, 'bookingId');
    const paymentId = pathId(request, 'paymentId');
    const payment = await this.payments.getPayment(bookingId, paymentId);
    if (!payment) throw new NotFoundError(`Payment ${paymentId} not found`);
    if (payment.customerId !== customerId) {
      throw new ForbiddenError('Not authorized to view this payment');
    }
    return toResponse(await this.reconcileExpiry(payment));
  }

  /**
   * Client checkout callback confirmation. Signature must verify against the
   * provider secret; the booking snapshot amount remains authoritative.
   */
  async confirmProviderPayment(request: LambdaRequest): Promise<CustomerPaymentResponse> {
    const customerId = requireCustomerId(request);
    const bookingId = pathId(request, 'bookingId');
    const paymentId = pathId(request, 'paymentId');
    const body = (request.body ?? {}) as {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
      orderId?: string;
      paymentId?: string;
      signature?: string;
    };
    const orderId = (body.razorpay_order_id ?? body.orderId ?? '').trim();
    const providerPaymentId = (body.razorpay_payment_id ?? body.paymentId ?? '').trim();
    const signature = (body.razorpay_signature ?? body.signature ?? '').trim();
    if (!orderId || !providerPaymentId || !signature) {
      throw new ValidationError('orderId, paymentId, and signature are required');
    }

    let payment = await this.payments.getPayment(bookingId, paymentId);
    if (!payment) throw new NotFoundError(`Payment ${paymentId} not found`);
    if (payment.customerId !== customerId) {
      throw new ForbiddenError('Not authorized to complete this payment');
    }
    payment = await this.reconcileExpiry(payment);
    if (payment.status === 'PAID') return toResponse(payment);
    if (payment.status !== 'PENDING') {
      throw new BusinessRuleError(`Payment ${paymentId} is ${payment.status}`);
    }
    if (payment.provider !== 'RAZORPAY') {
      throw new BusinessRuleError('Payment is not a Razorpay checkout');
    }
    if (payment.providerOrderId && payment.providerOrderId !== orderId) {
      throw new BusinessRuleError('Razorpay order does not match this payment');
    }

    const razorpay = getRazorpayGateway();
    if (!razorpay.verifyPaymentSignature({ orderId, paymentId: providerPaymentId, signature })) {
      throw new BookingError('PAYMENT_SIGNATURE_INVALID', 'Razorpay payment signature verification failed', 400);
    }

    return this.markPaid(payment, providerPaymentId);
  }

  /**
   * Razorpay webhook. Requires raw body + X-Razorpay-Signature. Never trusts
   * amount from the event without matching the stored payment record.
   */
  async handleRazorpayWebhook(request: LambdaRequest): Promise<{ received: true }> {
    const signature = headerValue(request, 'X-Razorpay-Signature')
      ?? headerValue(request, 'x-razorpay-signature')
      ?? '';
    const rawBody = typeof request.rawBody === 'string'
      ? request.rawBody
      : typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body ?? {});
    const razorpay = getRazorpayGateway();
    if (!razorpay.verifyWebhookSignature(rawBody, signature)) {
      throw new BookingError('PAYMENT_SIGNATURE_INVALID', 'Razorpay webhook signature verification failed', 400);
    }

    const payload = typeof request.body === 'string'
      ? JSON.parse(request.body) as Record<string, unknown>
      : (request.body ?? {}) as Record<string, unknown>;
    const event = typeof payload.event === 'string' ? payload.event : '';
    const entity = nested(payload, ['payload', 'payment', 'entity'])
      ?? nested(payload, ['payload', 'order', 'entity']);
    if (!entity) return { received: true };

    const providerPaymentId = typeof entity.id === 'string' && event.startsWith('payment.')
      ? entity.id
      : typeof entity.id === 'string' ? undefined : undefined;
    const orderId = typeof entity.order_id === 'string'
      ? entity.order_id
      : typeof entity.id === 'string' && event.startsWith('order.')
        ? entity.id
        : '';
    const notes = entity.notes && typeof entity.notes === 'object'
      ? entity.notes as Record<string, unknown>
      : {};
    const bookingId = typeof notes.bookingId === 'string' ? notes.bookingId : '';
    const paymentId = typeof notes.paymentId === 'string' ? notes.paymentId : '';

    let payment = paymentId && bookingId
      ? await this.payments.getPayment(bookingId, paymentId)
      : orderId
        ? await this.payments.getPaymentByProviderOrderId(orderId)
        : null;
    if (!payment) {
      this.logger.warn({ event: 'razorpay_webhook_payment_not_found', orderId, bookingId, paymentId });
      return { received: true };
    }
    payment = await this.reconcileExpiry(payment);
    if (payment.status === 'PAID') return { received: true };

    if (event === 'payment.captured' || event === 'order.paid') {
      const amount = typeof entity.amount === 'number' ? entity.amount : payment.providerAmountMinor;
      assertProviderAmountMatches(payment.amountMinor, payment.currency, amount);
      await this.markPaid(payment, providerPaymentId ?? payment.providerPaymentId);
      return { received: true };
    }

    if (event === 'payment.failed') {
      if (payment.status === 'PENDING') {
        await getBookingsService().failPaymentBooking({ bookingId: payment.bookingId });
        await this.payments.savePayment({
          ...payment,
          status: 'FAILED',
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          ...(providerPaymentId ? { providerPaymentId } : {}),
        });
      }
    }
    return { received: true };
  }

  /**
   * Sandbox-only completion. Never trust the client for amount; the booking
   * snapshot remains authoritative and confirmPaidBooking re-checks it.
   */
  async sandboxComplete(request: LambdaRequest): Promise<CustomerPaymentResponse> {
    if (!sandboxEnabled()) {
      throw new BookingError('SANDBOX_DISABLED', 'Sandbox payment completion is not enabled', 403);
    }
    const customerId = requireCustomerId(request);
    const bookingId = pathId(request, 'bookingId');
    const paymentId = pathId(request, 'paymentId');
    const outcome = typeof (request.body as { outcome?: unknown } | null)?.outcome === 'string'
      ? (request.body as { outcome: string }).outcome.trim().toUpperCase()
      : '';
    if (!['SUCCESS', 'FAILURE', 'CANCELLED'].includes(outcome)) {
      throw new ValidationError('outcome must be SUCCESS, FAILURE, or CANCELLED');
    }

    let payment = await this.payments.getPayment(bookingId, paymentId);
    if (!payment) throw new NotFoundError(`Payment ${paymentId} not found`);
    if (payment.customerId !== customerId) {
      throw new ForbiddenError('Not authorized to complete this payment');
    }
    payment = await this.reconcileExpiry(payment);

    if (payment.status === 'PAID') return toResponse(payment);
    if (payment.status !== 'PENDING') {
      throw new BusinessRuleError(`Payment ${paymentId} is ${payment.status}`);
    }

    const now = new Date().toISOString();
    if (outcome === 'SUCCESS') {
      return this.markPaid(payment);
    }

    await getBookingsService().failPaymentBooking({ bookingId });
    payment = await this.payments.savePayment({
      ...payment,
      status: outcome === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
      updatedAt: now,
      completedAt: now,
    });
    return toResponse(payment);
  }

  private async markPaid(
    payment: CustomerPaymentRecord,
    providerPaymentId?: string,
  ): Promise<CustomerPaymentResponse> {
    await getBookingsService().confirmPaidBooking({
      bookingId: payment.bookingId,
      amount: payment.amountMinor,
      currency: payment.currency,
    });
    const now = new Date().toISOString();
    const saved = await this.payments.savePayment({
      ...payment,
      status: 'PAID',
      updatedAt: now,
      completedAt: now,
      ...(providerPaymentId ? { providerPaymentId } : {}),
    });
    return toResponse(saved);
  }

  private async reconcileExpiry(payment: CustomerPaymentRecord): Promise<CustomerPaymentRecord> {
    if (payment.status !== 'PENDING') return payment;
    if (Date.parse(payment.expiresAt) > Date.now()) return payment;
    const expired = await this.payments.savePayment({
      ...payment,
      status: 'EXPIRED',
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    try {
      await getBookingsService().failPaymentBooking({ bookingId: payment.bookingId });
    } catch (error) {
      this.logger.warn({
        event: 'payment_expiry_booking_fail_skipped',
        bookingId: payment.bookingId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return expired;
  }
}

export function sandboxEnabled(): boolean {
  const stage = (env.STAGE || process.env.STAGE || '').toLowerCase();
  if (stage === 'prod' || stage === 'production') return false;
  return (env.PAYMENT_SANDBOX_ENABLED ?? process.env.PAYMENT_SANDBOX_ENABLED ?? 'true').toLowerCase() !== 'false';
}

export function resolveProvider(): PaymentProvider {
  const configured = (env.PAYMENT_PROVIDER || 'SANDBOX').trim().toUpperCase();
  if (configured === 'RAZORPAY') {
    if (getRazorpayGateway().isConfigured()) return 'RAZORPAY';
    throw new BookingError(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'PAYMENT_PROVIDER=RAZORPAY but Razorpay credentials are not configured',
      503,
    );
  }
  return 'SANDBOX';
}

export function pathId(request: LambdaRequest, key: string) {
  const value = request.pathParameters?.[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${key} is required`);
  }
  return value.trim();
}

function nested(value: Record<string, unknown>, path: string[]): Record<string, unknown> | null {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === 'object' ? current as Record<string, unknown> : null;
}

function toResponse(record: CustomerPaymentRecord): CustomerPaymentResponse {
  return {
    paymentId: record.paymentId,
    bookingId: record.bookingId,
    amountMinor: record.amountMinor,
    providerAmountMinor: record.providerAmountMinor ?? toProviderMinor(record.amountMinor, record.currency),
    currency: record.currency,
    status: record.status,
    provider: record.provider,
    checkoutToken: record.checkoutToken,
    ...(record.checkoutKeyId ? { checkoutKeyId: record.checkoutKeyId } : {}),
    ...(record.providerOrderId ? { providerOrderId: record.providerOrderId } : {}),
    expiresAt: record.expiresAt,
    sandboxEnabled: sandboxEnabled(),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
  };
}

let service: PaymentsService;

export function getPaymentsService() {
  if (!service) service = new PaymentsService();
  return service;
}
