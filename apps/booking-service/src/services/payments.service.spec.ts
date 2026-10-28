import { LambdaRequest } from '@api-hub/utils';

import { PaymentsService } from './payments.service';

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

  const service = new PaymentsService(
    payments as never,
    bookings as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYMENT_SANDBOX_ENABLED = 'true';
  });

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
});
