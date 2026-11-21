import { LambdaRequest } from '@api-hub/utils';

import { PaymentsService } from './payments.service';
import { setRazorpayGatewayForTests } from '../integrations/razorpay.client';

function paymentRequest(overrides: Partial<{ bookingId: string; key: string; customerId: string }> = {}): LambdaRequest {
  const bookingId = overrides.bookingId ?? 'b1';
  const key = overrides.key ?? 'pay-1';
  const customerId = overrides.customerId ?? 'c1';
  return {
    pathParameters: { bookingId },
    body: {},
    context: {
      authContext: { userId: customerId, roles: [], permissions: [], claims: {} },
      authHeader: 'Bearer token',
    },
    event: { headers: { 'Idempotency-Key': key } },
  } as unknown as LambdaRequest;
}

describe('PaymentsService', () => {
  const bookings = {
    getBookingById: jest.fn(),
  };
  const payments = {
    getIdempotentPayment: jest.fn(),
    createPayment: jest.fn(),
    getPayment: jest.fn(),
    savePayment: jest.fn(),
  };

  const lifecycle = {
    confirmPaidBooking: jest.fn(),
    failPaymentBooking: jest.fn(),
  };
  let service: PaymentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYMENT_SANDBOX_ENABLED = 'true';
    service = new PaymentsService(payments as never, bookings as never, lifecycle);
  });

  afterEach(() => setRazorpayGatewayForTests(undefined));

  it('initiates a payment from the booking snapshot amount, not a client amount', async () => {
    payments.getIdempotentPayment.mockResolvedValue(null);
    bookings.getBookingById.mockResolvedValue({
      id: 'b1',
      customerId: 'c1',
      bookingStatus: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      pricingSnapshot: { totalAmount: 499, totalMinor: 499, currency: 'INR' },
    });
    payments.createPayment.mockImplementation(async (record: unknown) => record);

    const result = await service.initiate(paymentRequest());

    expect(result.amountMinor).toBe(499);
    expect(result.status).toBe('PENDING');
    expect(result.provider).toBe('SANDBOX');
    expect(payments.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'b1', amountMinor: 499, idempotencyKey: 'pay-1' }),
    );
  });

  it('never creates a Razorpay or sandbox payment attempt for cash-on-service bookings', async () => {
    payments.getIdempotentPayment.mockResolvedValue(null);
    bookings.getBookingById.mockResolvedValue({
      id: 'b1', customerId: 'c1', bookingStatus: 'CONFIRMED',
      paymentMethod: 'CASH_ON_SERVICE', paymentStatus: 'PENDING',
    });

    await expect(service.initiate(paymentRequest())).rejects.toThrow('Cash-on-service');
    expect(payments.createPayment).not.toHaveBeenCalled();
  });

  it('replays an idempotent payment initiation', async () => {
    payments.getIdempotentPayment.mockResolvedValue({
      paymentId: 'p1',
      bookingId: 'b1',
      customerId: 'c1',
      amountMinor: 499,
      currency: 'INR',
      status: 'PENDING',
      provider: 'SANDBOX',
      checkoutToken: 'sandbox_x',
      idempotencyKey: 'pay-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await service.initiate(paymentRequest());

    expect(result.paymentId).toBe('p1');
    expect(payments.createPayment).not.toHaveBeenCalled();
  });

  it('settles a Razorpay payment only after a verified signature', async () => {
    const payment = {
      paymentId: 'p1', bookingId: 'b1', customerId: 'c1', amountMinor: 499,
      providerAmountMinor: 49900, currency: 'INR', status: 'PENDING' as const,
      provider: 'RAZORPAY' as const, checkoutToken: 'order_1', providerOrderId: 'order_1',
      idempotencyKey: 'pay-1', expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    payments.getPayment.mockResolvedValue(payment);
    payments.savePayment.mockImplementation(async (record: unknown) => record);
    lifecycle.confirmPaidBooking.mockResolvedValue({ id: 'b1', bookingStatus: 'CONFIRMED', paymentStatus: 'PAID' });
    setRazorpayGatewayForTests({
      isConfigured: () => true,
      publicKeyId: () => 'rzp_test_key',
      createOrder: jest.fn(),
      verifyPaymentSignature: () => true,
      verifyWebhookSignature: () => true,
    });

    const req = paymentRequest() as any;
    req.pathParameters.paymentId = 'p1';
    req.body = { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'verified' };
    const result = await service.confirmProviderPayment(req);

    expect(lifecycle.confirmPaidBooking).toHaveBeenCalledWith({ bookingId: 'b1', amount: 499, currency: 'INR' });
    expect(payments.savePayment).toHaveBeenCalledWith(expect.objectContaining({ status: 'PAID', providerPaymentId: 'pay_1' }));
    expect(result.status).toBe('PAID');
  });

  it('does not settle a payment when the Razorpay signature is invalid', async () => {
    payments.getPayment.mockResolvedValue({
      paymentId: 'p1', bookingId: 'b1', customerId: 'c1', amountMinor: 499,
      providerAmountMinor: 49900, currency: 'INR', status: 'PENDING', provider: 'RAZORPAY',
      checkoutToken: 'order_1', providerOrderId: 'order_1', idempotencyKey: 'pay-1',
      expiresAt: '2099-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });
    setRazorpayGatewayForTests({
      isConfigured: () => true,
      publicKeyId: () => 'rzp_test_key',
      createOrder: jest.fn(),
      verifyPaymentSignature: () => false,
      verifyWebhookSignature: () => false,
    });

    const req = paymentRequest() as any;
    req.pathParameters.paymentId = 'p1';
    req.body = { orderId: 'order_1', paymentId: 'pay_1', signature: 'invalid' };
    await expect(service.confirmProviderPayment(req)).rejects.toMatchObject({ code: 'PAYMENT_SIGNATURE_INVALID' });
    expect(lifecycle.confirmPaidBooking).not.toHaveBeenCalled();
    expect(payments.savePayment).not.toHaveBeenCalled();
  });
});
