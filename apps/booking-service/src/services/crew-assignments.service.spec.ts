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
    status: 'UNSCHEDULED',
    durationMinutes: 20,
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
  idempotencyKey?: string;
} = {}): LambdaRequest {
  return {
    pathParameters: {
      vendorId: input.vendorId ?? 'vendor-1',
      ...(input.visitId ? { visitId: input.visitId } : {}),
    },
    queryStringParameters: input.query ?? {},
    body: input.body,
    event: {
      headers: {
        'Idempotency-Key': input.idempotencyKey ?? 'idem-1',
      },
    },
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
    scheduleStartDate: '2026-10-30',
    scheduleEndDate: '2026-11-02',
    communityId: 'community-1',
    visitWindowId: 'night',
    crewId: 'crew-1',
    visitIds: ['visit-1'],
    ...overrides,
  };
}

describe('CrewAssignmentsService', () => {
  let plans: jest.Mocked<Pick<
    CustomerPlansRepository,
    | 'getVisitById'
    | 'getPlan'
    | 'listVendorVisitsForDate'
    | 'listVisits'
    | 'savePlan'
    | 'saveVisits'
    | 'saveScheduleAssignments'
    | 'getScheduleIdempotency'
  >>;
  let vendors: jest.Mocked<OperationalAccessGateway>;
  let roster: jest.Mocked<SchedulingCrewGateway>;
  let service: CrewAssignmentsService;

  beforeEach(() => {
    plans = {
      getVisitById: jest.fn().mockResolvedValue(visit()),
      getPlan: jest.fn().mockResolvedValue(plan),
      listVendorVisitsForDate: jest.fn().mockResolvedValue([]),
      listVisits: jest.fn().mockResolvedValue([visit()]),
      savePlan: jest.fn().mockResolvedValue(plan),
      saveVisits: jest.fn().mockResolvedValue(undefined),
      saveScheduleAssignments: jest.fn().mockResolvedValue(undefined),
      getScheduleIdempotency: jest.fn().mockResolvedValue(null),
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

  it('schedules and assigns unscheduled visits for a date range and window', async () => {
    const result = await service.assign(request({ body: assignBody() }));
    expect(result).toMatchObject({
      communityId: 'community-1',
      scheduleStartDate: '2026-10-30',
      scheduleEndDate: '2026-11-02',
      visitWindowId: 'night',
      crewId: 'crew-1',
      status: 'SCHEDULED',
      scheduledVisitCount: 1,
      idempotent: false,
    });
    expect(result.scheduleId).toMatch(/^SCH-/);
    expect(result?.visits[0]).toMatchObject({ visitId: 'visit-1', status: 'SCHEDULED', crewId: 'crew-1' });
    const saved = plans.saveScheduleAssignments.mock.calls[0][0].updates[0].next;
    expect(saved.status).toBe('SCHEDULED');
    expect(saved.scheduleStartDate).toBe('2026-10-30');
    expect(saved.scheduleEndDate).toBe('2026-11-02');
    expect(saved.crewAssignment).toMatchObject({ crewId: 'crew-1', assignedBy: 'owner-1' });
    expect(saved.schedule).toBeUndefined();
  });

  it('replays the same Idempotency-Key without rewriting', async () => {
    const { hashAssignmentRequest, parseAssignmentCommand } = require('../domain/crew-assignment') as typeof import('../domain/crew-assignment');
    const body = assignBody();
    const cached = {
      scheduleId: 'SCH-1',
      communityId: 'community-1',
      scheduleStartDate: '2026-10-30',
      scheduleEndDate: '2026-11-02',
      visitWindowId: 'night',
      crewId: 'crew-1',
      status: 'SCHEDULED',
      scheduledVisitCount: 1,
      visits: [{ visitId: 'visit-1', status: 'SCHEDULED', crewId: 'crew-1' }],
      idempotent: true,
      workload: { durationKnown: true, unknownDurationCount: 0, capacityKnown: false },
      travelWarnings: [],
      capacityAdvisory: false,
    };
    plans.getScheduleIdempotency.mockResolvedValue({
      PK: 'x',
      SK: 'IDEMPOTENCY',
      vendorId: 'vendor-1',
      idempotencyKey: 'idem-1',
      requestHash: hashAssignmentRequest(parseAssignmentCommand(body)),
      result: cached,
      entityType: 'VisitScheduleIdempotency',
      createdAt: '2026-10-30T00:00:00.000Z',
    });
    const result = await service.assign(request({ body }));
    expect(result.scheduleId).toBe('SCH-1');
    expect(plans.saveScheduleAssignments).not.toHaveBeenCalled();
  });

  it('rejects Idempotency-Key reuse with a different body', async () => {
    plans.getScheduleIdempotency.mockResolvedValue({
      PK: 'x',
      SK: 'IDEMPOTENCY',
      vendorId: 'vendor-1',
      idempotencyKey: 'idem-1',
      requestHash: 'other-hash',
      result: {},
      entityType: 'VisitScheduleIdempotency',
      createdAt: '2026-10-30T00:00:00.000Z',
    });
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({ statusCode: 409 });
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

  it('rejects a missing visit, window mismatch, or completed visit', async () => {
    plans.getVisitById.mockResolvedValue(null);
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({ statusCode: 404 });

    plans.getVisitById.mockResolvedValue(visit({ visitWindowId: 'morning' }));
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({ code: 'VISIT_WINDOW_MISMATCH' });

    plans.getVisitById.mockResolvedValue(visit({ status: 'COMPLETED' }));
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({ code: 'VISIT_NOT_ASSIGNABLE' });
  });

  it('rejects overlapping crew assignments across overlapping ranges', async () => {
    plans.listVendorVisitsForDate.mockImplementation(async () => ([
      visit({
        visitId: 'other',
        status: 'SCHEDULED',
        scheduleStartDate: '2026-10-30',
        scheduleEndDate: '2026-11-02',
        communityId: 'community-2',
        crewAssignment: { crewId: 'crew-1', assignedAt: '2026-10-29T00:00:00.000Z', assignedBy: 'owner-1' },
      }),
    ]));
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({ code: 'CREW_WINDOW_OVERLAP' });
    expect(plans.saveScheduleAssignments).not.toHaveBeenCalled();
  });

  it('returns 409 when two managers write the same visit', async () => {
    plans.saveScheduleAssignments.mockRejectedValue(new ConditionalWriteConflictError('version'));
    await expect(service.assign(request({ body: assignBody() }))).rejects.toMatchObject({
      code: 'ASSIGNMENT_CONFLICT',
      statusCode: 409,
    });
  });

  it('refuses to replace another crew unless requested', async () => {
    plans.getVisitById.mockResolvedValue(visit({
      status: 'SCHEDULED',
      scheduleStartDate: '2026-10-20',
      scheduleEndDate: '2026-10-22',
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

  it('removes an assignment without clearing the range commitment', async () => {
    plans.getVisitById.mockResolvedValue(visit({
      status: 'SCHEDULED',
      scheduleStartDate: '2026-10-30',
      scheduleEndDate: '2026-11-02',
      crewAssignment: { crewId: 'crew-1', assignedAt: '2026-10-29T00:00:00.000Z', assignedBy: 'owner-1' },
    }));
    const result = await service.remove(request({ visitId: 'visit-1' }));
    expect(result.idempotent).toBe(false);
    const saved = plans.saveVisits.mock.calls[0][0][0].next;
    expect(saved.crewAssignment).toBeUndefined();
    expect(saved.status).toBe('SCHEDULED');
    expect(saved.scheduleStartDate).toBe('2026-10-30');

    plans.getVisitById.mockResolvedValue(visit({
      status: 'SCHEDULED',
      scheduleStartDate: '2026-10-30',
      scheduleEndDate: '2026-11-02',
    }));
    const replay = await service.remove(request({ visitId: 'visit-1' }));
    expect(replay.idempotent).toBe(true);
  });

  it('groups a date by community and window including range commitments', async () => {
    plans.listVendorVisitsForDate.mockImplementation(async (_vendorId: string, date: string) => (
      date === '2026-10-30'
        ? [
          visit({
            status: 'SCHEDULED',
            scheduleStartDate: '2026-10-30',
            scheduleEndDate: '2026-11-02',
            crewAssignment: { crewId: 'crew-1', assignedAt: '2026-10-29T00:00:00.000Z', assignedBy: 'owner-1' },
          }),
          visit({
            visitId: 'visit-2',
            status: 'SCHEDULED',
            scheduleStartDate: '2026-10-30',
            scheduleEndDate: '2026-11-02',
            crewAssignment: undefined,
          }),
        ]
        : []
    ));
    const schedule = await service.list(request({ query: { fromDate: '2026-10-30', toDate: '2026-10-30' } }));
    expect(schedule.vanIdentity).toBe('displayLabelOnly');
    expect(schedule.days[0]).toMatchObject({ scheduledCount: 2, assignedCount: 1, unassignedCount: 1 });
  });
});
