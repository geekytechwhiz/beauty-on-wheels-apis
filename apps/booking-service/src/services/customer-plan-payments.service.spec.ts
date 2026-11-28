import { LambdaRequest } from '@api-hub/utils';

import { BookingError } from '../errors';
import { VendorGateway } from '../integrations/vendor.client';
import { BookingsRepository } from '../repositories/bookings.repository';
import { CustomerPlansRepository } from '../repositories/customer-plans.repository';
import { CustomerPlanRecord, PlanPaymentRecord } from '../types/customer-plan.types';
import { CustomerPlanPaymentsService } from './customer-plan-payments.service';

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
  planId: 'plan-1',
  customerId: 'customer-1',
  vendorId: 'vendor_1',
  packageId: 'pkg',
  offeringId: 'pkg',
  vehicleId: 'veh_1',
  vehicleType: 'SEDAN',
  status: 'PENDING_PAYMENT',
  paymentStatus: 'PENDING',
  billingPeriod: 'weekly',
  cadence: 'WEEKLY',
  remainingVisits: 3,
  entitlements: [{ serviceId: 'svc', quantity: 3 }],
  includedServices: [{ name: 'svc', categoryId: 'cat', visitsPerPeriod: 3, durationMinutes: 30 }],
  visitWindowId: 'morning',
  visitWindow: { visitWindowId: 'morning', label: 'Morning', startTime: '09:00', endTime: '12:00' },
  location: { fulfilmentType: 'community', communityId: 'comm_1' },
  pricingSnapshot: {
    totalAmount: 1999,
    totalMinor: 1999,
    currency: 'INR',
    packageId: 'pkg',
    offeringId: 'pkg',
    vehicleType: 'SEDAN',
    durationMinutes: 170,
  },
  autoRenew: false,
  version: 1,
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z',
};

const pendingPayment: PlanPaymentRecord = {
  paymentId: 'pay-id-1', planId: 'plan-1', customerId: 'customer-1', amountMinor: 1999, providerAmountMinor: 199900, currency: 'INR',
  status: 'PENDING', provider: 'SANDBOX', checkoutToken: 'sandbox_x', idempotencyKey: 'pay-1',
  expiresAt: '2099-01-01T00:00:00.000Z', createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z',
};

describe('CustomerPlanPaymentsService', () => {
  let plans: jest.Mocked<CustomerPlansRepository>;
  let bookings: jest.Mocked<BookingsRepository>;
  let vendors: jest.Mocked<VendorGateway>;
  let service: CustomerPlanPaymentsService;

  beforeEach(() => {
    process.env.PAYMENT_SANDBOX_ENABLED = 'true';
    plans = {
      getPlan: jest.fn().mockResolvedValue(plan),
      getIdempotentPayment: jest.fn().mockResolvedValue(null),
      listPayments: jest.fn().mockResolvedValue([]),
      createPayment: jest.fn().mockImplementation(async (record: PlanPaymentRecord) => record),
      getPayment: jest.fn().mockResolvedValue(pendingPayment),
      savePayment: jest.fn().mockImplementation(async (record: PlanPaymentRecord) => record),
      savePlan: jest.fn().mockImplementation(async (record: CustomerPlanRecord) => record),
      createVisitsIfAbsent: jest.fn().mockImplementation(async (visits) => visits),
      listVisits: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<CustomerPlansRepository>;
    bookings = {
      createPackageLinkedBooking: jest.fn().mockImplementation(async (booking) => booking),
    } as unknown as jest.Mocked<BookingsRepository>;
    vendors = {
      getCheckoutEligibility: jest.fn(),
      holdPlanCapacity: jest.fn().mockResolvedValue({
        commitmentId: 'cmt_1',
        quantity: 10,
        reservedSoldQuantity: 0,
        remainingSoldCapacity: 10,
        claimedPeriodQuantity: 3,
        periodSupply: 10,
      }),
      confirmPlanCapacity: jest.fn().mockResolvedValue({
        commitmentId: 'cmt_1',
        quantity: 10,
        reservedSoldQuantity: 0,
        remainingSoldCapacity: 10,
        claimedPeriodQuantity: 3,
        periodSupply: 10,
      }),
      releasePlanCapacity: jest.fn().mockResolvedValue(undefined),
      reservePlanCapacity: jest.fn().mockResolvedValue({
        commitmentId: 'cmt_1',
        quantity: 10,
        reservedSoldQuantity: 3,
        remainingSoldCapacity: 7,
        claimedPeriodQuantity: 3,
        periodSupply: 10,
      }),
      reserveVisitCapacity: jest.fn(),
      releaseVisitCapacity: jest.fn(),
    } as unknown as jest.Mocked<VendorGateway>;
    service = new CustomerPlanPaymentsService(plans, bookings, vendors);
  });

  it('initiates a payment with the amount taken from the plan snapshot', async () => {
    const result = await service.initiate(request({ body: { amountMinor: 1 } }));

    expect(result).toMatchObject({ planId: 'plan-1', amountMinor: 1999, providerAmountMinor: 199900, currency: 'INR', status: 'PENDING', provider: 'SANDBOX' });
    expect(result).not.toHaveProperty('customerId');
    expect(plans.createPayment).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 1999, customerId: 'customer-1' }));
    expect(vendors.holdPlanCapacity).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: 'vendor_1',
      communityId: 'comm_1',
      offeringId: 'pkg',
      demandQuantity: 3,
      planId: 'plan-1',
      paymentId: expect.any(String),
      expiresAt: expect.any(String),
      dailyWindow: { startTime: '09:00', endTime: '12:00' },
    }));
  });

  it('requires an Idempotency-Key and replays an existing payment', async () => {
    await expect(service.initiate(request({ key: null }))).rejects.toThrow('Idempotency-Key');
    plans.getIdempotentPayment.mockResolvedValue(pendingPayment);
    await expect(service.initiate(request())).resolves.toMatchObject({ paymentId: 'pay-id-1' });
    expect(plans.createPayment).not.toHaveBeenCalled();
  });

  it('reuses the active payment attempt instead of creating a second hold for the plan', async () => {
    plans.listPayments.mockResolvedValue([pendingPayment]);

    await expect(service.initiate(request({ key: 'new-key' }))).resolves.toMatchObject({ paymentId: 'pay-id-1' });

    expect(vendors.holdPlanCapacity).not.toHaveBeenCalled();
    expect(plans.createPayment).not.toHaveBeenCalled();
  });

  it('refuses another customer and an already paid plan', async () => {
    await expect(service.initiate(request({ customerId: 'customer-2' }))).rejects.toMatchObject({ statusCode: 403 });
    plans.getPlan.mockResolvedValue({ ...plan, status: 'AWAITING_FIRST_JOB', paymentStatus: 'PAID', firstJobId: 'job-1' });
    await expect(service.initiate(request())).rejects.toThrow('already paid');
  });

  it('marks the plan AWAITING_FIRST_JOB, materializes visits, and links the first job when sandbox completion succeeds', async () => {
    const result = await service.sandboxComplete(request({ paymentId: 'pay-id-1', body: { outcome: 'SUCCESS' } }));

    expect(vendors.confirmPlanCapacity).toHaveBeenCalledWith({
      vendorId: 'vendor_1',
      communityId: 'comm_1',
      offeringId: 'pkg',
      demandQuantity: 3,
      planId: 'plan-1',
      paymentId: 'pay-id-1',
      dailyWindow: { startTime: '09:00', endTime: '12:00' },
    });
    expect(result.status).toBe('PAID');
    expect(plans.createVisitsIfAbsent).toHaveBeenCalled();
    expect(bookings.createPackageLinkedBooking).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'plan-1',
      packageId: 'pkg',
      offeringId: 'pkg',
      paymentStatus: 'PAID',
      bookingStatus: 'CONFIRMED',
      serviceIds: [],
      slotId: '',
    }));
    const linked = bookings.createPackageLinkedBooking.mock.calls[0][0];
    expect(linked).not.toHaveProperty('branchId');
    expect(linked).not.toHaveProperty('schedule');
    // Service start date stays unset until the first PackageVisit slot is confirmed.
    expect(linked).not.toHaveProperty('bookingDate');
    expect(typeof linked.createdAt).toBe('string');
    expect(plans.savePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'AWAITING_FIRST_JOB',
        paymentStatus: 'PAID',
        remainingVisits: 3,
        version: 2,
        firstJobId: expect.any(String),
        autoRenew: false,
        visitProgress: expect.objectContaining({ totalVisits: 3, unscheduledVisits: 3 }),
      }),
      1,
    );
    const saved = plans.savePlan.mock.calls[0][0] as CustomerPlanRecord;
    expect(saved.billingPeriodStart).toBeUndefined();
    expect(saved.billingPeriodEnd).toBeUndefined();
  });

  it('keeps the plan PENDING_PAYMENT when the payment fails or is cancelled', async () => {
    const failed = await service.sandboxComplete(request({ paymentId: 'pay-id-1', body: { outcome: 'FAILURE' } }));
    expect(failed.status).toBe('FAILED');
    const cancelled = await service.sandboxComplete(request({ paymentId: 'pay-id-1', body: { outcome: 'CANCELLED' } }));
    expect(cancelled.status).toBe('CANCELLED');
    expect(plans.savePlan).not.toHaveBeenCalled();
    expect(bookings.createPackageLinkedBooking).not.toHaveBeenCalled();
    expect(vendors.releasePlanCapacity).toHaveBeenCalledTimes(2);
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
    expect(vendors.releasePlanCapacity).toHaveBeenCalledWith('plan-1');
  });

  it('rejects another customer completing a payment', async () => {
    await expect(service.sandboxComplete(request({ customerId: 'customer-2', paymentId: 'pay-id-1', body: { outcome: 'SUCCESS' } })))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses checkout before creating a payment when vendor capacity is unavailable', async () => {
    vendors.holdPlanCapacity.mockRejectedValue(
      new BookingError('CAPACITY_UNAVAILABLE', 'No capacity', 409, undefined, false),
    );

    await expect(
      service.initiate(request()),
    ).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE', statusCode: 409 });

    expect(plans.createPayment).not.toHaveBeenCalled();
  });
});
