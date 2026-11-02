import { LambdaRequest } from '@api-hub/utils';

import { SchedulingCrew } from '../domain/crew-assignment';
import { encodeStaffToken } from '../domain/staff-assigned-work';
import { OperationalAccessGateway } from '../integrations/vendor.client';
import { SchedulingCrewGateway } from '../integrations/scheduling-crews.client';
import { CustomerPlansRepository } from '../repositories/customer-plans.repository';
import { CustomerPlanRecord } from '../types/customer-plan.types';
import { PackageVisitRecord } from '../types/package-visit.types';
import { PackageVisitsService } from './package-visits.service';
import { StaffAssignedWorkService } from './staff-assigned-work.service';

const NOW = new Date('2026-10-29T02:30:00.000Z');

function crew(overrides: Partial<SchedulingCrew> = {}): SchedulingCrew {
  return {
    crewId: 'crew-1',
    vendorId: 'vendor-1',
    name: 'Crew Alpha',
    vanLabel: 'Van 01',
    status: 'ACTIVE',
    staff: [
      { staffId: 'staff-1', status: 'ACTIVE', name: 'Arun' },
      { staffId: 'staff-2', status: 'ACTIVE', name: 'Rahul' },
    ],
    ...overrides,
  };
}

function visit(overrides: Partial<PackageVisitRecord> = {}): PackageVisitRecord {
  return {
    visitId: 'visit-1',
    planId: 'plan-1',
    customerId: 'customer-secret',
    vendorId: 'vendor-1',
    communityId: 'community-1',
    visitWindowId: 'night',
    visitWindowName: 'Night',
    registrationNumber: 'KL07AB1234',
    vehicleDisplayName: 'Hyundai i20',
    serviceId: 'exterior',
    serviceName: 'Exterior Wash',
    sequence: 1,
    ordinal: 1,
    status: 'SCHEDULED',
    durationMinutes: 30,
    schedule: {
      date: '2026-10-29',
      startTime: '21:00',
      endTime: '21:30',
      timezone: 'Asia/Kolkata',
      branchId: 'branch-1',
      durationMinutes: 30,
    },
    scheduleHistory: [],
    crewAssignment: { crewId: 'crew-1', assignedAt: '2026-10-28T00:00:00.000Z', assignedBy: 'owner-1' },
    entitlementConsumed: false,
    version: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function request(query: Record<string, string> = {}, userId = 'user-1'): LambdaRequest {
  return {
    params: { ...query },
    context: {
      authContext: { userId, roles: [], permissions: [], claims: {} },
    },
  } as unknown as LambdaRequest;
}

describe('StaffAssignedWorkService', () => {
  let plans: jest.Mocked<Pick<CustomerPlansRepository, 'listVendorVisitsForDate' | 'getPlan'>>;
  let vendors: jest.Mocked<OperationalAccessGateway>;
  let crews: jest.Mocked<SchedulingCrewGateway>;
  let service: StaffAssignedWorkService;

  beforeEach(() => {
    plans = {
      listVendorVisitsForDate: jest.fn().mockResolvedValue([]),
      getPlan: jest.fn().mockResolvedValue(null),
    };
    vendors = {
      getOperationalAccess: jest.fn().mockResolvedValue({
        role: 'staff',
        vendorId: 'vendor-1',
        staffId: 'staff-1',
        active: true,
      }),
    };
    crews = { listCrews: jest.fn().mockResolvedValue([crew()]) };
    service = new StaffAssignedWorkService(
      plans as unknown as CustomerPlansRepository,
      vendors,
      crews,
      () => NOW,
    );
  });

  it('returns only visits assigned to the authenticated staff member crews', async () => {
    plans.listVendorVisitsForDate.mockResolvedValue([
      visit(),
      visit({ visitId: 'other-crew', crewAssignment: { crewId: 'crew-9', assignedAt: '2026-10-28T00:00:00.000Z', assignedBy: 'owner-1' } }),
      visit({ visitId: 'unassigned', crewAssignment: undefined }),
      visit({ visitId: 'other-vendor', vendorId: 'vendor-2' }),
      visit({ visitId: 'cancelled', status: 'CANCELLED' }),
    ]);
    const page = await service.list(request({ vendorId: 'vendor-evil', staffId: 'staff-evil', crewId: 'crew-9' }));
    expect(vendors.getOperationalAccess).toHaveBeenCalledWith('user-1');
    expect(crews.listCrews).toHaveBeenCalledWith('vendor-1');
    expect(plans.listVendorVisitsForDate).toHaveBeenCalledWith('vendor-1', '2026-10-29');
    expect(page.items.map((item) => item.visitId)).toEqual(['cancelled', 'visit-1']);
    expect(page.metrics).toMatchObject({ assigned: 1, remaining: 1, cancelled: 1, completed: 0, inProgress: 0 });
    expect(page.items[1]).toMatchObject({
      serviceName: 'Exterior Wash',
      vehicle: { registrationNumber: 'KL07AB1234', displayName: 'Hyundai i20' },
    });
    expect(JSON.stringify(page)).not.toContain('customer-secret');
    expect(page.crews).toEqual([{
      crewId: 'crew-1',
      name: 'Crew Alpha',
      vanLabel: 'Van 01',
      staff: [
        { staffId: 'staff-1', name: 'Arun' },
        { staffId: 'staff-2', name: 'Rahul' },
      ],
    }]);
  });

  it('rejects an unauthenticated request before reading membership', async () => {
    await expect(service.list({ context: {} } as LambdaRequest)).rejects.toMatchObject({ statusCode: 401 });
    expect(vendors.getOperationalAccess).not.toHaveBeenCalled();
  });

  it('rejects inactive staff and owners', async () => {
    vendors.getOperationalAccess.mockResolvedValue({ role: 'staff', vendorId: 'vendor-1', staffId: 'staff-1', active: false });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
    vendors.getOperationalAccess.mockResolvedValue({ role: 'owner', vendorId: 'vendor-1', active: true });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(plans.listVendorVisitsForDate).not.toHaveBeenCalled();
  });

  it('returns an empty result when the staff member has no active crew', async () => {
    crews.listCrews.mockResolvedValue([crew({ status: 'INACTIVE' })]);
    const page = await service.list(request());
    expect(page.reason).toBe('noCrewAssignment');
    expect(page.items).toEqual([]);
    expect(page.crews).toEqual([]);
    expect(page.metrics.assigned).toBe(0);
    expect(plans.listVendorVisitsForDate).not.toHaveBeenCalled();
  });

  it('includes every active crew instead of keeping only the first', async () => {
    crews.listCrews.mockResolvedValue([
      crew(),
      crew({
        crewId: 'crew-2',
        name: 'Crew Beta',
        vanLabel: 'Van 02',
        staff: [{ staffId: 'staff-1', status: 'ACTIVE', name: 'Arun' }],
      }),
    ]);
    plans.listVendorVisitsForDate.mockResolvedValue([
      visit(),
      visit({
        visitId: 'visit-2',
        crewAssignment: { crewId: 'crew-2', assignedAt: '2026-10-28T00:00:00.000Z', assignedBy: 'owner-1' },
      }),
    ]);
    const page = await service.list(request());
    expect(page.crews.map((item) => item.crewId)).toEqual(['crew-1', 'crew-2']);
    expect(page.items.map((item) => item.visitId)).toEqual(['visit-1', 'visit-2']);
  });

  it('drops visits when crew membership changes on the next request', async () => {
    plans.listVendorVisitsForDate.mockResolvedValue([
      visit(),
      visit({
        visitId: 'visit-2',
        crewAssignment: { crewId: 'crew-2', assignedAt: '2026-10-28T00:00:00.000Z', assignedBy: 'owner-1' },
      }),
    ]);
    crews.listCrews.mockResolvedValueOnce([crew(), crew({ crewId: 'crew-2', name: 'Crew Beta', vanLabel: 'Van 02' })]);
    const first = await service.list(request());
    crews.listCrews.mockResolvedValueOnce([crew({ crewId: 'crew-2', name: 'Crew Beta', vanLabel: 'Van 02' })]);
    const second = await service.list(request());
    expect(first.items.map((item) => item.visitId)).toEqual(['visit-1', 'visit-2']);
    expect(second.items.map((item) => item.visitId)).toEqual(['visit-2']);
  });

  it('counts the full date range when items are paginated', async () => {
    plans.listVendorVisitsForDate.mockResolvedValue([
      visit({ visitId: 'a', registrationNumber: 'KL07AA0001' }),
      visit({ visitId: 'b', registrationNumber: 'KL07AA0002', status: 'IN_PROGRESS' }),
      visit({ visitId: 'c', registrationNumber: 'KL07AA0003', status: 'COMPLETED' }),
    ]);
    const first = await service.list(request({ limit: '1' }));
    const second = await service.list(request({ limit: '1', nextToken: first.nextToken ?? '' }));
    expect(first.items).toHaveLength(1);
    expect(first.metrics).toMatchObject({ assigned: 3, remaining: 1, inProgress: 1, completed: 1 });
    expect(second.metrics.assigned).toBe(3);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].visitId).not.toBe(first.items[0].visitId);
  });

  it('filters by the requested date and status', async () => {
    plans.listVendorVisitsForDate.mockImplementation(async (_vendorId: string, date: string) => (
      date === '2026-10-30' ? [visit({ schedule: { ...visit().schedule!, date: '2026-10-30' } })] : []
    ));
    const page = await service.list(request({ date: '2026-10-30', status: 'SCHEDULED' }));
    expect(plans.listVendorVisitsForDate).toHaveBeenCalledWith('vendor-1', '2026-10-30');
    expect(page.fromDate).toBe('2026-10-30');
    expect(page.items).toHaveLength(1);
    const missed = await service.list(request({ date: '2026-10-30', status: 'MISSED' }));
    expect(missed.items).toEqual([]);
  });

  it('reports an unknown window when no clock was stored and does not use the slot time', async () => {
    plans.listVendorVisitsForDate.mockResolvedValue([visit()]);
    const page = await service.list(request());
    expect(page.items[0].windowTimeKnown).toBe(false);
    expect(page.items[0].windowStart).toBeUndefined();
    expect(page.items[0].windowEnd).toBeUndefined();
    expect(JSON.stringify(page.items[0])).not.toContain('21:00');
  });

  it('uses a plan clock when the visit has none, including an overnight window', async () => {
    plans.listVendorVisitsForDate.mockResolvedValue([
      visit({ visitId: 'day' }),
      visit({
        visitId: 'night',
        visitWindowSnapshot: {
          visitWindowId: 'night',
          startTime: '22:00',
          endTime: '02:00',
          timezone: 'Asia/Kolkata',
        },
      }),
    ]);
    plans.getPlan.mockResolvedValue({
      planId: 'plan-1',
      vendorId: 'vendor-1',
      location: { fulfilmentType: 'community', communityId: 'community-1' },
      visitWindowId: 'night',
      visitWindow: {
        visitWindowId: 'night',
        label: 'Night',
        startTime: '20:00',
        endTime: '23:00',
        timezone: 'Asia/Kolkata',
      },
    } as CustomerPlanRecord);
    const page = await service.list(request());
    const day = page.items.find((item) => item.visitId === 'day');
    const night = page.items.find((item) => item.visitId === 'night');
    expect(day).toMatchObject({ windowTimeKnown: true, windowStart: '20:00', windowEnd: '23:00' });
    expect(night).toMatchObject({
      windowTimeKnown: true,
      windowStart: '22:00',
      windowEnd: '02:00',
      crossesMidnight: true,
    });
  });

  it('rejects a nextToken that is not a page cursor', async () => {
    await expect(service.list(request({ nextToken: 'nope' }))).rejects.toMatchObject({ statusCode: 400 });
    expect(encodeStaffToken(0)).toEqual(expect.any(String));
  });

  it('starts the caller crew visit and ignores a client staff id and clock', async () => {
    const visits = {
      applyStart: jest.fn().mockResolvedValue({
        response: {
          visitId: 'visit-1',
          status: 'IN_PROGRESS',
          startedAt: NOW.toISOString(),
          entitlementConsumed: false,
        },
        idempotent: false,
      }),
    };
    const actions = actionService(visits);
    (plans as unknown as { getVisitById: jest.Mock }).getVisitById = jest.fn().mockResolvedValue(visit());
    plans.getPlan.mockResolvedValue({ planId: 'plan-1', vendorId: 'vendor-1' } as CustomerPlanRecord);
    const result = await actions.start({
      ...request(),
      pathParameters: { visitId: 'visit-1' },
      body: { staffId: 'staff-evil', vendorId: 'vendor-evil', startedAt: '2000-01-01T00:00:00.000Z' },
    } as LambdaRequest);
    expect(visits.applyStart).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'plan-1' }),
      expect.objectContaining({ visitId: 'visit-1' }),
      'staff-1',
      NOW.toISOString(),
    );
    expect(result).toEqual({
      visitId: 'visit-1',
      status: 'IN_PROGRESS',
      startedAt: NOW.toISOString(),
      entitlementConsumed: false,
      idempotent: false,
    });
    expect(result).not.toHaveProperty('customerId');
  });

  it('refuses a visit assigned to another crew and does not write it', async () => {
    const visits = { applyStart: jest.fn() };
    const actions = actionService(visits);
    (plans as unknown as { getVisitById: jest.Mock }).getVisitById = jest.fn().mockResolvedValue(visit({
      crewAssignment: { crewId: 'crew-9', assignedAt: '2026-10-28T00:00:00.000Z', assignedBy: 'owner-1' },
    }));
    await expect(actions.start({
      ...request(),
      pathParameters: { visitId: 'visit-1' },
    } as LambdaRequest)).rejects.toMatchObject({ statusCode: 403 });
    expect(visits.applyStart).not.toHaveBeenCalled();
  });

  it('completes once for the caller and requires an idempotency key', async () => {
    const visits = {
      applyComplete: jest.fn().mockResolvedValue({
        response: {
          visitId: 'visit-1',
          status: 'COMPLETED',
          completedAt: NOW.toISOString(),
          entitlementConsumed: true,
        },
        idempotent: false,
      }),
    };
    const actions = actionService(visits);
    (plans as unknown as { getVisitById: jest.Mock }).getVisitById = jest.fn().mockResolvedValue(visit({ status: 'IN_PROGRESS' }));
    plans.getPlan.mockResolvedValue({ planId: 'plan-1', vendorId: 'vendor-1' } as CustomerPlanRecord);
    await expect(actions.complete({
      ...request(),
      pathParameters: { visitId: 'visit-1' },
      event: { headers: {} },
    } as LambdaRequest)).rejects.toMatchObject({ statusCode: 400 });
    const completed = await actions.complete({
      ...request(),
      pathParameters: { visitId: 'visit-1' },
      event: { headers: { 'Idempotency-Key': 'complete-1' } },
      body: {
        completedAt: '1999-01-01T00:00:00.000Z',
        checklist: [{ itemId: 'wash', label: 'Exterior washed', done: true }],
      },
    } as LambdaRequest);
    expect(visits.applyComplete).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'staff-1',
      NOW.toISOString(),
      { checklist: [{ itemId: 'wash', label: 'Exterior washed', done: true }] },
      expect.anything(),
    );
    expect(completed.entitlementConsumed).toBe(true);
    expect(completed.status).toBe('COMPLETED');
  });

  it('rejects a bodyless complete without calling the visit service', async () => {
    const visits = { applyComplete: jest.fn() };
    const actions = actionService(visits);
    (plans as unknown as { getVisitById: jest.Mock }).getVisitById = jest.fn().mockResolvedValue(visit({ status: 'IN_PROGRESS' }));
    plans.getPlan.mockResolvedValue({ planId: 'plan-1', vendorId: 'vendor-1' } as CustomerPlanRecord);
    await expect(actions.complete({
      ...request(),
      pathParameters: { visitId: 'visit-1' },
      event: { headers: { 'Idempotency-Key': 'complete-1' } },
    } as LambdaRequest)).rejects.toBeDefined();
    expect(visits.applyComplete).not.toHaveBeenCalled();
  });

  function actionService(visits: Partial<PackageVisitsService>): StaffAssignedWorkService {
    return new StaffAssignedWorkService(
      plans as unknown as CustomerPlansRepository,
      vendors,
      crews,
      () => NOW,
      visits as PackageVisitsService,
    );
  }
});
