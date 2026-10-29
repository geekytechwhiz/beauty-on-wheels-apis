import { LambdaRequest } from '@api-hub/utils';

import { AvailabilityGateway } from '../integrations/availability.client';
import { CustomerPlansRepository } from '../repositories/customer-plans.repository';
import { CustomerPlanRecord } from '../types/customer-plan.types';
import { PackageVisitRecord } from '../types/package-visit.types';
import { PackageVisitsService } from './package-visits.service';

const plan: CustomerPlanRecord = {
  planId: 'plan-1',
  customerId: 'customer-1',
  vendorId: 'vendor-1',
  packageId: 'pkg',
  offeringId: 'pkg',
  vehicleId: 'veh-1',
  vehicleType: 'SEDAN',
  status: 'AWAITING_FIRST_JOB',
  paymentStatus: 'PAID',
  billingPeriod: 'oneTime',
  cadence: 'ONE_TIME',
  remainingVisits: 2,
  entitlements: [{ serviceId: 'exterior-wash', quantity: 2 }],
  includedServices: [
    { name: 'Exterior', serviceKey: 'exterior-wash', categoryId: 'cat', visitsPerPeriod: 2, durationMinutes: 30 },
  ],
  visitWindowId: 'morning',
  visitWindow: { visitWindowId: 'morning', label: 'Morning' },
  location: { fulfilmentType: 'community', communityId: 'c1' },
  pricingSnapshot: {
    totalAmount: 1999,
    totalMinor: 1999,
    currency: 'INR',
    packageId: 'pkg',
    offeringId: 'pkg',
    vehicleType: 'SEDAN',
  },
  autoRenew: false,
  version: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  activatedAt: '2026-01-01T00:00:00.000Z',
};

const visit: PackageVisitRecord = {
  visitId: 'visit-1',
  planId: 'plan-1',
  customerId: 'customer-1',
  vendorId: 'vendor-1',
  serviceId: 'exterior-wash',
  serviceName: 'Exterior',
  sequence: 1,
  ordinal: 1,
  status: 'UNSCHEDULED',
  durationMinutes: 30,
  scheduleHistory: [],
  entitlementConsumed: false,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function customerRequest(overrides: Partial<{ body: unknown; path: Record<string, string>; key: string }> = {}): LambdaRequest {
  return {
    body: overrides.body ?? {},
    pathParameters: { planId: 'plan-1', visitId: 'visit-1', ...(overrides.path ?? {}) },
    queryStringParameters: {},
    context: {
      authContext: { userId: 'customer-1', roles: [], permissions: [], claims: {} },
    },
    event: { headers: { 'Idempotency-Key': overrides.key ?? 'idem-1' } },
  } as unknown as LambdaRequest;
}

function vendorRequest(overrides: Partial<{ body: unknown; key: string }> = {}): LambdaRequest {
  return {
    body: overrides.body ?? {
      date: '2026-01-10',
      startTime: '09:00',
      timezone: 'Asia/Kolkata',
      branchId: 'branch-1',
      durationMinutes: 30,
    },
    pathParameters: { planId: 'plan-1', visitId: 'visit-1' },
    queryStringParameters: {},
    context: {
      authContext: {
        userId: 'staff-1',
        roles: ['vendor_staff'],
        permissions: [],
        claims: { vendorId: 'vendor-1', staffId: 'staff-1' },
      },
    },
    event: { headers: { 'Idempotency-Key': overrides.key ?? 'idem-1' } },
  } as unknown as LambdaRequest;
}

describe('PackageVisitsService', () => {
  let plans: jest.Mocked<CustomerPlansRepository>;
  let availability: jest.Mocked<AvailabilityGateway>;
  let service: PackageVisitsService;

  beforeEach(() => {
    plans = {
      getPlan: jest.fn().mockResolvedValue(plan),
      getVisit: jest.fn().mockResolvedValue(visit),
      listVisits: jest.fn().mockResolvedValue([visit]),
      listVisitsPage: jest.fn().mockResolvedValue({ items: [visit] }),
      saveVisit: jest.fn().mockImplementation(async (record) => record),
      savePlan: jest.fn().mockImplementation(async (record) => record),
      completeVisitAndUpdatePlan: jest.fn().mockImplementation(async (input) => input),
    } as unknown as jest.Mocked<CustomerPlansRepository>;
    availability = {
      reserveBooking: jest.fn().mockResolvedValue({
        slotId: 'slot-1',
        date: '2026-01-10',
        startTime: '09:00',
        endTime: '09:30',
        timezone: 'Asia/Kolkata',
        durationMinutes: 30,
      }),
      releaseAllocation: jest.fn().mockResolvedValue(undefined),
      consumeHold: jest.fn(),
    } as unknown as jest.Mocked<AvailabilityGateway>;
    service = new PackageVisitsService(plans, availability);
  });

  it('lets the customer list visits but not schedule or complete', async () => {
    const page = await service.list(customerRequest());
    expect(page.items).toHaveLength(1);
    await expect(service.schedule(customerRequest())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.complete(customerRequest())).rejects.toMatchObject({ statusCode: 403 });
  });

  it('schedules a visit after reserving availability', async () => {
    const result = await service.schedule(vendorRequest());
    expect(availability.reserveBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'visit-1',
      packageVisitId: 'visit-1',
      planId: 'plan-1',
      branchId: 'branch-1',
    }));
    expect(result.status).toBe('SCHEDULED');
    expect(plans.saveVisit).toHaveBeenCalled();
  });

  it('keeps the original reservation when reschedule reserve fails', async () => {
    plans.getVisit.mockResolvedValue({
      ...visit,
      status: 'SCHEDULED',
      schedule: {
        date: '2026-01-10',
        startTime: '09:00',
        timezone: 'Asia/Kolkata',
        branchId: 'branch-1',
        allocationId: 'visit-1',
        durationMinutes: 30,
      },
    });
    availability.reserveBooking.mockRejectedValue(Object.assign(new Error('full'), {
      code: 'SLOT_UNAVAILABLE',
      statusCode: 409,
    }));
    await expect(service.reschedule(vendorRequest({
      body: {
        date: '2026-01-11',
        startTime: '10:00',
        timezone: 'Asia/Kolkata',
        branchId: 'branch-1',
        durationMinutes: 30,
      },
    }))).rejects.toMatchObject({ statusCode: 409 });
    expect(availability.releaseAllocation).not.toHaveBeenCalled();
    expect(plans.saveVisit).not.toHaveBeenCalled();
  });

  it('completes a visit once and updates plan progress idempotently', async () => {
    const inProgress = {
      ...visit,
      status: 'IN_PROGRESS' as const,
      schedule: {
        date: '2026-01-10',
        startTime: '09:00',
        timezone: 'Asia/Kolkata',
        branchId: 'branch-1',
        allocationId: 'visit-1',
        durationMinutes: 30,
      },
    };
    plans.getVisit.mockResolvedValue(inProgress);
    plans.listVisits.mockResolvedValue([inProgress]);
    const result = await service.complete(vendorRequest());
    expect(result.status).toBe('COMPLETED');
    expect(result.entitlementConsumed).toBe(true);
    expect(plans.completeVisitAndUpdatePlan).toHaveBeenCalled();

    plans.getVisit.mockResolvedValue({ ...result, customerId: 'customer-1', version: 2 } as PackageVisitRecord);
    const replay = await service.complete(vendorRequest({ key: 'idem-1' }));
    expect(replay.status).toBe('COMPLETED');
  });

  it('records PARTIAL when confirm-schedules has a failure', async () => {
    const second: PackageVisitRecord = { ...visit, visitId: 'visit-2', ordinal: 2, sequence: 2 };
    plans.listVisits.mockResolvedValue([visit, second]);
    plans.getVisit
      .mockResolvedValueOnce(visit)
      .mockResolvedValueOnce(second);
    availability.reserveBooking
      .mockResolvedValueOnce({
        slotId: 'slot-1',
        date: '2026-01-10',
        startTime: '09:00',
        endTime: '09:30',
        timezone: 'Asia/Kolkata',
        durationMinutes: 30,
      })
      .mockRejectedValueOnce(Object.assign(new Error('full'), { code: 'SLOT_UNAVAILABLE', statusCode: 409 }));

    const result = await service.confirmSchedules(vendorRequest({
      body: {
        visits: [
          { visitId: 'visit-1', date: '2026-01-10', startTime: '09:00', timezone: 'Asia/Kolkata', branchId: 'branch-1', durationMinutes: 30 },
          { visitId: 'visit-2', date: '2026-01-11', startTime: '09:00', timezone: 'Asia/Kolkata', branchId: 'branch-1', durationMinutes: 30 },
        ],
      },
    }));
    expect(result.scheduled).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.scheduleState).toBe('PARTIAL');
  });
});
