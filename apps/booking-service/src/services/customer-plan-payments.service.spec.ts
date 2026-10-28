import { LambdaRequest } from '@api-hub/utils';

import { CustomerPlanPaymentsService } from './customer-plan-payments.service';
import { CustomerPlansRepository } from '../repositories/customer-plans.repository';
import { CustomerPlanRecord, PlanPaymentRecord } from '../types/customer-plan.types';

function request(options: { customerId?: string; key?: string | null; body?: unknown; paymentId?: string } = {}): LambdaRequest {
  const key = options.key === undefined ? 'pay-1' : options.key;
  return {
    body: options.body ?? {},
    pathParameters: { planId: 'plan-1', ...(options.paymentId ? { paymentId: options.paymentId } : {}) },
    context: { authContext: { userId: options.customerId ?? 'customer-1', roles: [], permissions: [], claims: {} } },
    event: { headers: key ? { 'Idempotency-Key': key } : {} },
  } as unknown as LambdaRequest;
}

const plan: CustomerPlanRecord = {
  planId: 'plan-1', customerId: 'customer-1', vendorId: 'vendor_1', branchId: 'branch_1', packageId: 'pkg', vehicleId: 'veh_1',
  status: 'PENDING_PAYMENT', paymentStatus: 'PENDING', cadence: 'WEEKLY', remainingVisits: 3,
  entitlements: [{ serviceId: 'svc', quantity: 3 }],
  visitWindow: { preferredDays: ['MON'], startTime: '09:00', endTime: '12:00', timezone: 'Asia/Kolkata' },
  location: { fulfilmentType: 'community', communityId: 'comm_1' },
  pricingSnapshot: { totalAmount: 1999, totalMinor: 1999, currency: 'INR', packageId: 'pkg' },
  version: 1, createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z',
};

const pendingPayment: PlanPaymentRecord = {
  paymentId: 'pay-id-1', planId: 'plan-1', customerId: 'customer-1', amountMinor: 1999, providerAmountMinor: 199900, currency: 'INR',
  status: 'PENDING', provider: 'SANDBOX', checkoutToken: 'sandbox_x', idempotencyKey: 'pay-1',
  expiresAt: '2099-01-01T00:00:00.000Z', createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z',
};

describe('CustomerPlanPaymentsService', () => {
  let plans: jest.Mocked<CustomerPlansRepository>;
  let service: CustomerPlanPaymentsService;

  beforeEach(() => {
    process.env.PAYMENT_SANDBOX_ENABLED = 'true';
    plans = {
      getPlan: jest.fn().mockResolvedValue(plan),
      getIdempotentPayment: jest.fn().mockResolvedValue(null),
      createPayment: jest.fn().mockImplementation(async (record: PlanPaymentRecord) => record),
      getPayment: jest.fn().mockResolvedValue(pendingPayment),
      savePayment: jest.fn().mockImplementation(async (record: PlanPaymentRecord) => record),
      savePlan: jest.fn().mockImplementation(async (record: CustomerPlanRecord) => record),
    } as unknown as jest.Mocked<CustomerPlansRepository>;
    service = new CustomerPlanPaymentsService(plans);
  });

  it('initiates a payment with the amount taken from the plan snapshot', async () => {
    const result = await service.initiate(request({ body: { amountMinor: 1 } }));

    expect(result).toMatchObject({ planId: 'plan-1', amountMinor: 1999, providerAmountMinor: 199900, currency: 'INR', status: 'PENDING', provider: 'SANDBOX' });
    expect(result).not.toHaveProperty('customerId');
    expect(plans.createPayment).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 1999, customerId: 'customer-1' }));
  });

  it('requires an Idempotency-Key and replays an existing payment', async () => {
    await expect(service.initiate(request({ key: null }))).rejects.toThrow('Idempotency-Key');
    plans.getIdempotentPayment.mockResolvedValue(pendingPayment);
    await expect(service.initiate(request())).resolves.toMatchObject({ paymentId: 'pay-id-1' });
    expect(plans.createPayment).not.toHaveBeenCalled();
  });

  it('refuses another customer and an already active plan', async () => {
    await expect(service.initiate(request({ customerId: 'customer-2' }))).rejects.toMatchObject({ statusCode: 403 });
    plans.getPlan.mockResolvedValue({ ...plan, status: 'ACTIVE', paymentStatus: 'PAID' });
    await expect(service.initiate(request())).rejects.toThrow('already paid');
  });

  it('activates the plan when sandbox completion succeeds', async () => {
    const result = await service.sandboxComplete(request({ paymentId: 'pay-id-1', body: { outcome: 'SUCCESS' } }));

    expect(result.status).toBe('PAID');
    expect(plans.savePlan).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ACTIVE', paymentStatus: 'PAID', remainingVisits: 3, version: 2 }),
      1,
    );
  });

  it('keeps the plan PENDING_PAYMENT when the payment fails or is cancelled', async () => {
    const failed = await service.sandboxComplete(request({ paymentId: 'pay-id-1', body: { outcome: 'FAILURE' } }));
    expect(failed.status).toBe('FAILED');
    const cancelled = await service.sandboxComplete(request({ paymentId: 'pay-id-1', body: { outcome: 'CANCELLED' } }));
    expect(cancelled.status).toBe('CANCELLED');
    expect(plans.savePlan).not.toHaveBeenCalled();
  });

  it('does not activate when the stored payment amount disagrees with the plan snapshot', async () => {
    plans.getPayment.mockResolvedValue({ ...pendingPayment, amountMinor: 1 });
    await expect(service.sandboxComplete(request({ paymentId: 'pay-id-1', body: { outcome: 'SUCCESS' } })))
      .rejects.toMatchObject({ code: 'PAYMENT_AMOUNT_MISMATCH' });
    expect(plans.savePlan).not.toHaveBeenCalled();
  });

  it('marks an expired pending payment EXPIRED on read', async () => {
    plans.getPayment.mockResolvedValue({ ...pendingPayment, expiresAt: '2020-01-01T00:00:00.000Z' });
    const result = await service.getPayment(request({ paymentId: 'pay-id-1' }));
    expect(result.status).toBe('EXPIRED');
  });

  it('rejects another customer completing a payment', async () => {
    await expect(service.sandboxComplete(request({ customerId: 'customer-2', paymentId: 'pay-id-1', body: { outcome: 'SUCCESS' } })))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});
