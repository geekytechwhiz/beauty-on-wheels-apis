import { ConditionalWriteConflictError, LambdaRequest } from '@api-hub/utils';

import { SchedulingCrew } from '../domain/crew-assignment';
import { SchedulingCrewGateway } from '../integrations/scheduling-crews.client';
import { OperationalAccessGateway } from '../integrations/vendor.client';
import { CustomerPlansRepository } from '../repositories/customer-plans.repository';
import { CustomerPlanRecord } from '../types/customer-plan.types';
import { PackageVisitRecord } from '../types/package-visit.types';
import { CrewAssignmentsService } from './crew-assignments.service';

const plan = {
  planId: 'plan-1',
  customerId: 'customer-1',
  vendorId: 'vendor-1',
  packageId: 'pkg',
  offeringId: 'pkg',
  vehicleId: 'vehicle-1',
  vehicleType: 'HATCHBACK',
  status: 'ACTIVE',
  paymentStatus: 'PAID',
  billingPeriod: 'monthly',
  cadence: 'MONTHLY',
  remainingVisits: 1,
  entitlements: [],
  includedServices: [],
  visitWindowId: 'night',
  visitWindow: { visitWindowId: 'night', label: 'Night', startTime: '18:00', endTime: '21:00' },
  location: { fulfilmentType: 'community', communityId: 'community-1' },
  pricingSnapshot: {
    totalAmount: 1,
    totalMinor: 1,
    currency: 'INR',
    packageId: 'pkg',
    offeringId: 'pkg',
    vehicleType: 'HATCHBACK',
  },
  autoRenew: false,
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
} as CustomerPlanRecord;

function crew(overrides: Partial<SchedulingCrew> = {}): SchedulingCrew {
  return {
    crewId: 'crew-1',
    vendorId: 'vendor-1',
    name: 'Crew Alpha',
    vanLabel: 'Van 01',
    status: 'ACTIVE',
    staff: [
      { staffId: 'staff-1', status: 'ACTIVE', name: 'Asha' },
      { staffId: 'staff-2', status: 'ACTIVE', name: 'Ravi' },
    ],
    ...overrides,
  };
}

function visit(overrides: Partial<PackageVisitRecord> = {}): PackageVisitRecord {
  return {
    visitId: 'visit-1',
    planId: 'plan-1',
    customerId: 'customer-1',
    vendorId: 'vendor-1',
    communityId: 'community-1',
    visitWindowId: 'night',
    visitWindowName: 'Night',
    serviceId: 'exterior',
    serviceName: 'Exterior Wash',
    sequence: 1,
    ordinal: 1,
    status: 'SCHEDULED',
    durationMinutes: 20,
    schedule: {
      date: '2026-10-30',
      startTime: '18:10',
      endTime: '18:30',
      timezone: 'Asia/Kolkata',
      branchId: 'branch-1',
      allocationId: 'visit-1',
      durationMinutes: 20,
    },
    scheduleHistory: [],
    entitlementConsumed: false,
    version: 3,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    registrationNumber: 'KL07AB1234',
    ...overrides,
  };
}

function request(input: {
  method?: string;
  userId?: string;
  roles?: string[];
  vendorId?: string;
  visitId?: string;
  body?: unknown;
  query?: Record<string, string>;
} = {}): LambdaRequest {
  return {
    pathParameters: {
      vendorId: input.vendorId ?? 'vendor-1',
      ...(input.visitId ? { visitId: input.visitId } : {}),
    },
    queryStringParameters: input.query ?? {},
    body: input.body,
    context: {
      authContext: {
        userId: input.userId ?? 'owner-1',
        roles: input.roles ?? [],
        permissions: [],
        claims: {},
      },
    },
  } as unknown as LambdaRequest;
}

function assignBody(overrides: Record<string, unknown> = {}) {
  return {
    scheduledDate: '2026-10-30',
    communityId: 'community-1',
    visitWindowId: 'night',
    crewId: 'crew-1',
    visitIds: ['visit-1'],
    ...overrides,
  };
}

describe('CrewAssignmentsService', () => {
  let plans: jest.Mocked<Pick<CustomerPlansRepository, 'getVisitById' | 'getPlan' | 'listVendorVisitsForDate' | 'saveVisits'>>;
  let vendors: jest.Mocked<OperationalAccessGateway>;
  let roster: jest.Mocked<SchedulingCrewGateway>;
  let service: CrewAssignmentsService;

  beforeEach(() => {
    plans = {
      getVisitById: jest.fn().mockResolvedValue(visit()),
      getPlan: jest.fn().mockResolvedValue(plan),
      listVendorVisitsForDate: jest.fn().mockResolvedValue([]),
      saveVisits: jest.fn().mockResolvedValue(undefined),
    };
    vendors = {
      getOperationalAccess: jest.fn().mockResolvedValue({ role: 'owner', vendorId: 'vendor-1', active: true }),
    };
    roster = {
      listCrews: jest.fn().mockResolvedValue([crew()]),
    };
    service = new CrewAssignmentsService(
      plans as unknown as CustomerPlansRepository,
      vendors,
      roster,
      () => new Date('2026-10-30T04:00:00.000Z'),
      30,
    );
  });

  it('assigns an active crew and keeps the visit scheduled', async () => {
    const result = await service.assign(request({ body: assignBody() }));
    expect(result.idempotent).toBe(false);
    expect(result.workload).toMatchObject({ estimatedMinutes: 20, availableMinutes: 180, overloaded: false });
    const saved = plans.saveVisits.mock.calls[0][0][0].next;
    expect(saved.status).toBe('SCHEDULED');
    expect(saved.crewAssignment).toMatchObject({ crewId: 'crew-1', assignedBy: 'owner-1' });
    expect(saved.schedule?.allocationId).toBe('visit-1');
    expect(saved.entitlementConsumed).toBe(false);
  });

  it('treats the same assignment as a retry', async () => {
    plans.getVisitById.mockResolvedValue(visit({
      crewAssignment: { crewId: 'crew-1', assignedAt: '2026-10-29T00:00:00.000Z', assignedBy: 'owner-1' },
    }));
    const result = await service.assign(request({ body: assignBody() }));
    expect(result.idempotent).toBe(true);
    expect(plans.saveVisits).not.toHaveBeenCalled();
  });

  it('rejects staff and another vendor', async () => {
    vendors.getOperationalAccess.mockResolvedValue({ role: 'staff', vendorId: 'vendor-1', staffId: 'staff-1', active: true });
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({ statusCode: 403 });

    vendors.getOperationalAccess.mockResolvedValue({ role: 'owner', vendorId: 'vendor-1', active: true });
    plans.getVisitById.mockResolvedValue(visit({ vendorId: 'vendor-2' }));
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({ code: 'CROSS_VENDOR_VISIT' });
  });

  it('rejects an inactive crew and a crew with fewer than two active staff', async () => {
    roster.listCrews.mockResolvedValue([crew({ status: 'INACTIVE' })]);
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({ code: 'CREW_INACTIVE' });

    roster.listCrews.mockResolvedValue([crew({
      status: 'ACTIVE',
      staff: [
        { staffId: 'staff-1', status: 'ACTIVE' },
        { staffId: 'staff-2', status: 'INACTIVE' },
      ],
    })]);
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({ code: 'CREW_TOO_SMALL' });
  });

  it('rejects a missing, unscheduled, or completed visit', async () => {
    plans.getVisitById.mockResolvedValue(null);
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({ statusCode: 404 });

    plans.getVisitById.mockResolvedValue(visit({ status: 'UNSCHEDULED', schedule: undefined }));
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({ code: 'VISIT_NOT_ASSIGNABLE' });

    plans.getVisitById.mockResolvedValue(visit({ status: 'COMPLETED' }));
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({ code: 'VISIT_NOT_ASSIGNABLE' });
  });

  it('rejects overlapping crew and staff assignments', async () => {
    plans.listVendorVisitsForDate.mockImplementation(async (_vendorId: string, date: string) => (
      date === '2026-10-30'
        ? [visit({
          visitId: 'other',
          communityId: 'community-2',
          crewAssignment: { crewId: 'crew-1', assignedAt: '2026-10-29T00:00:00.000Z', assignedBy: 'owner-1' },
        })]
        : []
    ));
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({ code: 'CREW_WINDOW_OVERLAP' });

    roster.listCrews.mockResolvedValue([
      crew(),
      crew({
        crewId: 'crew-2',
        name: 'Crew Beta',
        vanLabel: 'Van 01',
        staff: [
          { staffId: 'staff-2', status: 'ACTIVE' },
          { staffId: 'staff-3', status: 'ACTIVE' },
        ],
      }),
    ]);
    plans.listVendorVisitsForDate.mockImplementation(async (_vendorId: string, date: string) => (
      date === '2026-10-30'
        ? [visit({
          visitId: 'other',
          crewAssignment: { crewId: 'crew-1', assignedAt: '2026-10-29T00:00:00.000Z', assignedBy: 'owner-1' },
        })]
        : []
    ));
    await expect(service.assign(request({
      body: assignBody({ crewId: 'crew-2', visitIds: ['visit-1'] }),
    }))).rejects.toMatchObject({ code: 'STAFF_WINDOW_OVERLAP' });
    expect(plans.saveVisits).not.toHaveBeenCalled();
  });

  it('does not treat a shared van label as a vehicle conflict', async () => {
    roster.listCrews.mockResolvedValue([
      crew(),
      crew({
        crewId: 'crew-2',
        vanLabel: 'Van 01',
        staff: [
          { staffId: 'staff-3', status: 'ACTIVE' },
          { staffId: 'staff-4', status: 'ACTIVE' },
        ],
      }),
    ]);
    plans.getPlan.mockImplementation(async (planId: string) => (
      planId === 'plan-morning'
        ? {
          ...plan,
          planId,
          visitWindowId: 'morning',
          visitWindow: { visitWindowId: 'morning', label: 'Morning', startTime: '06:00', endTime: '09:00' },
        }
        : plan
    ));
    plans.getVisitById.mockResolvedValue(visit({
      planId: 'plan-morning',
      visitWindowId: 'morning',
      visitWindowName: 'Morning',
      schedule: {
        date: '2026-10-30',
        startTime: '06:10',
        timezone: 'Asia/Kolkata',
        branchId: 'branch-1',
        durationMinutes: 20,
      },
    }));
    plans.listVendorVisitsForDate.mockImplementation(async (_vendorId: string, date: string) => (
      date === '2026-10-30'
        ? [visit({
          visitId: 'other',
          crewAssignment: { crewId: 'crew-1', assignedAt: '2026-10-29T00:00:00.000Z', assignedBy: 'owner-1' },
        })]
        : []
    ));
    await expect(service.assign(request({
      body: assignBody({ crewId: 'crew-2', visitWindowId: 'morning' }),
    }))).resolves.toMatchObject({ crewId: 'crew-2' });
  });

  it('returns 409 when two managers write the same visit', async () => {
    plans.saveVisits.mockRejectedValue(new ConditionalWriteConflictError('version'));
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({
      code: 'ASSIGNMENT_CONFLICT',
      statusCode: 409,
    });
  });

  it('refuses to replace another crew unless requested', async () => {
    plans.getVisitById.mockResolvedValue(visit({
      crewAssignment: { crewId: 'crew-2', assignedAt: '2026-10-29T00:00:00.000Z', assignedBy: 'owner-2' },
    }));
    roster.listCrews.mockResolvedValue([
      crew(),
      crew({
        crewId: 'crew-2',
        staff: [
          { staffId: 'staff-3', status: 'ACTIVE' },
          { staffId: 'staff-4', status: 'ACTIVE' },
        ],
      }),
    ]);
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({ code: 'CREW_ASSIGNMENT_CONFLICT' });
    await expect(service.assign(request({ body: assignBody({ replaceExisting: true }) }))).resolves.toMatchObject({ crewId: 'crew-1' });
  });

  it('removes an assignment without releasing the reservation', async () => {
    plans.getVisitById.mockResolvedValue(visit({
      crewAssignment: { crewId: 'crew-1', assignedAt: '2026-10-29T00:00:00.000Z', assignedBy: 'owner-1' },
    }));
    const result = await service.remove(request({ visitId: 'visit-1' }));
    expect(result.idempotent).toBe(false);
    const saved = plans.saveVisits.mock.calls[0][0][0].next;
    expect(saved.crewAssignment).toBeUndefined();
    expect(saved.status).toBe('SCHEDULED');
    expect(saved.schedule?.allocationId).toBe('visit-1');

    plans.getVisitById.mockResolvedValue(visit());
    const replay = await service.remove(request({ visitId: 'visit-1' }));
    expect(replay.idempotent).toBe(true);
  });

  it('warns when duration is missing and when the travel buffer is short', async () => {
    plans.getVisitById.mockResolvedValue(visit({ durationMinutes: 0 }));
    const missing = await service.assign(request({ body: assignBody() }));
    expect(missing.workload.durationKnown).toBe(false);
    expect(missing.workload.overloaded).toBeUndefined();
    expect(missing.capacityAdvisory).toBe(false);

    plans.getVisitById.mockResolvedValue(visit());
    const eveningPlan = {
      ...plan,
      planId: 'plan-evening',
      visitWindowId: 'evening',
      visitWindow: { visitWindowId: 'evening', label: 'Evening', startTime: '16:00', endTime: '17:50' },
    };
    plans.listVendorVisitsForDate.mockResolvedValue([visit({
      visitId: 'earlier',
      planId: 'plan-evening',
      communityId: 'community-2',
      visitWindowId: 'evening',
      crewAssignment: { crewId: 'crew-1', assignedAt: '2026-10-29T00:00:00.000Z', assignedBy: 'owner-1' },
    })]);
    plans.getPlan.mockImplementation(async (planId: string) => (planId === 'plan-evening' ? eveningPlan : plan));
    const warned = await service.assign(request({ body: assignBody() }));
    expect(warned.travelWarnings[0]).toMatchObject({ verified: true, gapMinutes: 10 });
    expect(plans.saveVisits).toHaveBeenCalled();
  });

  it('groups a date by community and window', async () => {
    plans.listVendorVisitsForDate.mockImplementation(async (_vendorId: string, date: string) => (
      date === '2026-10-30'
        ? [
          visit({ crewAssignment: { crewId: 'crew-1', assignedAt: '2026-10-29T00:00:00.000Z', assignedBy: 'owner-1' } }),
          visit({ visitId: 'visit-2', crewAssignment: undefined }),
        ]
        : []
    ));
    const schedule = await service.list(request({ query: { fromDate: '2026-10-30', toDate: '2026-10-30' } }));
    expect(schedule.vanIdentity).toBe('displayLabelOnly');
    expect(schedule.days[0]).toMatchObject({ scheduledCount: 2, assignedCount: 1, unassignedCount: 1 });
    expect(schedule.days[0].groups[0].crews[0]).toMatchObject({
      crewId: 'crew-1',
      visitCount: 1,
      workload: { estimatedMinutes: 20, overloaded: false },
    });
    expect(schedule.days[0].groups[0].unassignedVisits.map((item) => item.visitId)).toEqual(['visit-2']);
  });
});
