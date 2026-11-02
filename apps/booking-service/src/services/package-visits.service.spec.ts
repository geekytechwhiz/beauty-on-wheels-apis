import { LambdaRequest } from '@api-hub/utils';

import { AvailabilityGateway } from '../integrations/availability.client';
import { CustomerPlansRepository } from '../repositories/customer-plans.repository';
import { CustomerPlanRecord } from '../types/customer-plan.types';
import { PackageVisitRecord } from '../types/package-visit.types';
import { EvidenceStorage } from '../storage/evidence-storage';
import { PackageVisitsService } from './package-visits.service';

const checklist = [{ itemId: 'wash', label: 'Exterior washed', done: true }];
const completeBody = (extra: Record<string, unknown> = {}) => ({ checklist, ...extra });

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
  let issues: { listBlockingVisitIssues: jest.Mock };
  let storage: jest.Mocked<EvidenceStorage>;
  let service: PackageVisitsService;

  const inProgressVisit = (): PackageVisitRecord => ({
    ...visit,
    status: 'IN_PROGRESS',
    schedule: {
      date: '2026-01-10',
      startTime: '09:00',
      timezone: 'Asia/Kolkata',
      branchId: 'branch-1',
      allocationId: 'visit-1',
      durationMinutes: 30,
    },
  });

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
    issues = { listBlockingVisitIssues: jest.fn().mockResolvedValue([]) };
    storage = {
      isConfigured: jest.fn().mockReturnValue(true),
      createUploadUrl: jest.fn(),
      headObject: jest.fn().mockResolvedValue({ contentType: 'image/jpeg' }),
    } as unknown as jest.Mocked<EvidenceStorage>;
    service = new PackageVisitsService(plans, availability, issues, () => storage);
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
    expect(plans.saveVisit.mock.calls[0][0].visitWindowSnapshot).toBeUndefined();
  });

  it('persists a stored visit-window clock without copying the reserved slot time', async () => {
    plans.getPlan.mockResolvedValue({
      ...plan,
      visitWindowId: 'night',
      visitWindow: {
        visitWindowId: 'night',
        label: 'Night',
        startTime: '20:00',
        endTime: '02:00',
        timezone: 'Asia/Kolkata',
      },
    });
    await service.schedule(vendorRequest());
    const saved = plans.saveVisit.mock.calls[0][0];
    expect(saved.visitWindowSnapshot).toEqual({
      visitWindowId: 'night',
      startTime: '20:00',
      endTime: '02:00',
      timezone: 'Asia/Kolkata',
    });
    expect(saved.schedule?.startTime).toBe('09:00');
    expect(saved.schedule?.endTime).toBe('09:30');
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

  it('clears a crew assignment when a visit is cancelled or rescheduled', async () => {
    const assigned = {
      ...visit,
      status: 'SCHEDULED' as const,
      crewAssignment: { crewId: 'crew-1', assignedAt: '2026-01-09T00:00:00.000Z', assignedBy: 'staff-1' },
      schedule: {
        date: '2026-01-10',
        startTime: '09:00',
        timezone: 'Asia/Kolkata',
        branchId: 'branch-1',
        allocationId: 'visit-1',
        durationMinutes: 30,
      },
    };
    plans.getVisit.mockResolvedValue(assigned);
    await service.cancel(customerRequest({ body: { reason: 'customer' } }));
    expect(plans.saveVisit.mock.calls[0][0].crewAssignment).toBeUndefined();
    expect(plans.saveVisit.mock.calls[0][0].status).toBe('CANCELLED');
    expect(availability.releaseAllocation).toHaveBeenCalledWith('visit-1');

    plans.getVisit.mockResolvedValue(assigned);
    await service.reschedule(vendorRequest({
      body: {
        date: '2026-01-11',
        startTime: '10:00',
        timezone: 'Asia/Kolkata',
        branchId: 'branch-1',
        durationMinutes: 30,
      },
    }));
    const rescheduled = plans.saveVisit.mock.calls.at(-1)?.[0];
    expect(availability.reserveBooking).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-01-11' }));
    expect(rescheduled.crewAssignment).toBeUndefined();
    expect(rescheduled.status).toBe('SCHEDULED');
    expect(rescheduled.schedule).toBeDefined();
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
    const result = await service.complete(vendorRequest({ body: completeBody() }));
    expect(result.status).toBe('COMPLETED');
    expect(result.entitlementConsumed).toBe(true);
    expect(result.validationStatus).toBe('PENDING_REVIEW');
    expect(result.payoutEligible).toBe(false);
    expect(result.completionEvidence?.submittedBy.staffId).toBe('staff-1');
    expect(plans.completeVisitAndUpdatePlan).toHaveBeenCalled();

    plans.getVisit.mockResolvedValue({ ...result, customerId: 'customer-1', version: 2 } as PackageVisitRecord);
    const replay = await service.complete(vendorRequest({ key: 'idem-1', body: completeBody() }));
    expect(replay.status).toBe('COMPLETED');
    expect(plans.completeVisitAndUpdatePlan).toHaveBeenCalledTimes(1);
  });

  it('refuses completion while an unresolved blocking issue is linked to the visit', async () => {
    const inProgress = inProgressVisit();
    plans.getVisit.mockResolvedValue(inProgress);
    plans.listVisits.mockResolvedValue([inProgress]);
    issues.listBlockingVisitIssues.mockResolvedValue([
      { issueId: 'issue-1', vendorId: 'vendor-1', visitId: 'visit-1', status: 'ACTION_REQUIRED' },
    ]);
    await expect(service.complete(vendorRequest({ body: completeBody() })))
      .rejects.toMatchObject({ statusCode: 409, code: 'BLOCKING_ISSUE_OPEN' });
    expect(issues.listBlockingVisitIssues).toHaveBeenCalledWith('visit-1');
    expect(plans.completeVisitAndUpdatePlan).not.toHaveBeenCalled();
    expect(plans.saveVisit).not.toHaveBeenCalled();

    issues.listBlockingVisitIssues.mockResolvedValue([]);
    await expect(service.complete(vendorRequest({ body: completeBody() }))).resolves.toMatchObject({
      status: 'COMPLETED',
    });
  });

  it('rejects a bodyless or incomplete checklist before writing anything', async () => {
    const inProgress = inProgressVisit();
    plans.getVisit.mockResolvedValue(inProgress);
    await expect(service.complete(vendorRequest({ body: {} }))).rejects.toBeDefined();
    await expect(service.complete(vendorRequest({
      body: { checklist: [{ itemId: 'wash', label: 'Exterior washed', done: false }] },
    }))).rejects.toBeDefined();
    expect(plans.completeVisitAndUpdatePlan).not.toHaveBeenCalled();
  });

  it('only accepts evidence keys issued for this visit and uploaded', async () => {
    const inProgress = inProgressVisit();
    plans.getVisit.mockResolvedValue(inProgress);
    plans.listVisits.mockResolvedValue([inProgress]);
    await expect(service.complete(vendorRequest({
      body: completeBody({ evidenceObjectKeys: ['visit-evidence/vendor-1/other-visit/a.jpg'] }),
    }))).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_EVIDENCE_KEY' });

    const key = 'visit-evidence/vendor-1/visit-1/a.jpg';
    storage.headObject.mockResolvedValueOnce(null);
    await expect(service.complete(vendorRequest({ body: completeBody({ evidenceObjectKeys: [key] }) })))
      .rejects.toMatchObject({ statusCode: 409, code: 'EVIDENCE_NOT_UPLOADED' });

    const done = await service.complete(vendorRequest({ body: completeBody({ evidenceObjectKeys: [key] }) }));
    expect(done.completionEvidence?.evidenceKeys).toEqual([key]);
  });

  it('answers 501 for evidence keys when storage is not configured but accepts checklist-only', async () => {
    const inProgress = inProgressVisit();
    plans.getVisit.mockResolvedValue(inProgress);
    plans.listVisits.mockResolvedValue([inProgress]);
    storage.isConfigured.mockReturnValue(false);
    await expect(service.complete(vendorRequest({
      body: completeBody({ evidenceObjectKeys: ['visit-evidence/vendor-1/visit-1/a.jpg'] }),
    }))).rejects.toMatchObject({ statusCode: 501, code: 'EVIDENCE_STORAGE_NOT_CONFIGURED' });
    await expect(service.complete(vendorRequest({ body: completeBody() }))).resolves.toMatchObject({
      validationStatus: 'PENDING_REVIEW',
      payoutEligible: false,
    });
  });

  it('refuses a replay with different evidence and locks it once approved', async () => {
    const completed = {
      ...inProgressVisit(),
      status: 'COMPLETED' as const,
      entitlementConsumed: true,
      validationStatus: 'APPROVED' as const,
      payoutEligible: true,
      completionEvidence: {
        checklist,
        evidenceKeys: [],
        submittedAt: '2026-01-10T05:00:00.000Z',
        submittedBy: { staffId: 'staff-1' },
      },
    };
    plans.getVisit.mockResolvedValue(completed);
    await expect(service.complete(vendorRequest({
      body: { checklist: [{ itemId: 'other', label: 'Different', done: true }] },
    }))).rejects.toMatchObject({ statusCode: 409, code: 'EVIDENCE_LOCKED' });
    plans.getVisit.mockResolvedValue({ ...completed, validationStatus: 'PENDING_REVIEW', payoutEligible: false });
    await expect(service.complete(vendorRequest({
      body: { checklist: [{ itemId: 'other', label: 'Different', done: true }] },
    }))).rejects.toMatchObject({ statusCode: 409, code: 'VISIT_ALREADY_COMPLETED' });
    expect(plans.completeVisitAndUpdatePlan).not.toHaveBeenCalled();
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

  it('marks a visit missed only after the stored window ends and does not consume entitlement', async () => {
    const scheduled: PackageVisitRecord = {
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
      visitWindowSnapshot: {
        visitWindowId: 'morning',
        startTime: '09:00',
        endTime: '10:00',
        timezone: 'Asia/Kolkata',
      },
    };
    await expect(service.applyMiss(plan, scheduled, new Date('2026-01-10T04:29:00.000Z')))
      .rejects.toMatchObject({ code: 'WINDOW_NOT_ELAPSED', statusCode: 409 });
    expect(plans.saveVisit).not.toHaveBeenCalled();
    expect(availability.releaseAllocation).not.toHaveBeenCalled();

    const missed = await service.applyMiss(plan, scheduled, new Date('2026-01-10T04:30:00.000Z'));
    expect(missed.idempotent).toBe(false);
    expect(missed.response.status).toBe('MISSED');
    expect(missed.response.entitlementConsumed).toBe(false);
    expect(plans.saveVisit.mock.calls[0][0].missedAt).toBe('2026-01-10T04:30:00.000Z');
    expect(availability.reserveBooking).not.toHaveBeenCalled();
    expect(availability.releaseAllocation).not.toHaveBeenCalled();
    expect(plans.completeVisitAndUpdatePlan).not.toHaveBeenCalled();
  });

  it('keeps one-time booking completion separate from package visit completion', async () => {
    const inProgress = { ...visit, status: 'IN_PROGRESS' as const };
    plans.getVisit.mockResolvedValue(inProgress);
    plans.listVisits.mockResolvedValue([inProgress]);
    await service.complete(vendorRequest({ body: completeBody() }));
    expect(plans.completeVisitAndUpdatePlan).toHaveBeenCalledTimes(1);
    expect(availability.reserveBooking).not.toHaveBeenCalled();
    expect(availability.releaseAllocation).not.toHaveBeenCalled();
    expect(availability.consumeHold).not.toHaveBeenCalled();
  });
});
