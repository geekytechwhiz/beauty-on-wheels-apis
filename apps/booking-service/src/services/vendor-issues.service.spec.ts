import { LambdaRequest } from '@api-hub/utils';

import { SchedulingCrewGateway } from '../integrations/scheduling-crews.client';
import { OperationalAccess, OperationalAccessGateway } from '../integrations/vendor.client';
import { CustomerPlansRepository } from '../repositories/customer-plans.repository';
import { VendorIssuesRepository } from '../repositories/vendor-issues.repository';
import { PackageVisitRecord } from '../types/package-visit.types';
import { VendorIssueRecord } from '../types/vendor-issue.types';
import { VendorIssuesService } from './vendor-issues.service';

const NOW = new Date('2026-10-30T10:00:00.000Z');

const visit: PackageVisitRecord = {
  visitId: 'visit-1',
  planId: 'plan-1',
  customerId: 'customer-1',
  vendorId: 'vendor-1',
  communityId: 'community-1',
  serviceId: 'wash',
  serviceName: 'Wash',
  sequence: 1,
  ordinal: 1,
  status: 'IN_PROGRESS',
  durationMinutes: 30,
  scheduleHistory: [],
  entitlementConsumed: false,
  crewAssignment: { crewId: 'crew-1', assignedAt: '2026-10-29T00:00:00.000Z', assignedBy: 'owner-1' },
  version: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function req(input: {
  userId: string;
  roles?: string[];
  body?: unknown;
  path?: Record<string, string>;
  query?: Record<string, string>;
  key?: string;
}): LambdaRequest {
  return {
    body: input.body,
    pathParameters: { vendorId: 'vendor-1', ...(input.path ?? {}) },
    params: input.query ?? {},
    context: { authContext: { userId: input.userId, roles: input.roles ?? [], permissions: [], claims: {} } },
    event: { headers: input.key === undefined ? { 'Idempotency-Key': 'k-1' } : { 'Idempotency-Key': input.key } },
  } as unknown as LambdaRequest;
}

describe('VendorIssuesService', () => {
  let store: Map<string, VendorIssueRecord>;
  let idempotency: Map<string, { issueId: string; requestHash: string }>;
  let issues: jest.Mocked<VendorIssuesRepository>;
  let plans: { getVisitById: jest.Mock };
  let access: Record<string, OperationalAccess>;
  let service: VendorIssuesService;

  beforeEach(() => {
    store = new Map();
    idempotency = new Map();
    issues = {
      createIssue: jest.fn(async (record: VendorIssueRecord, idem: { key: string; requestHash: string }) => {
        store.set(record.issueId, record);
        idempotency.set(idem.key, { issueId: record.issueId, requestHash: idem.requestHash });
      }),
      saveIssue: jest.fn(async (next: VendorIssueRecord) => { store.set(next.issueId, next); }),
      getIssue: jest.fn(async (_vendor: string, id: string) => store.get(id) ?? null),
      getIssueById: jest.fn(async (id: string) => store.get(id) ?? null),
      getIdempotency: jest.fn(async (_vendor: string, key: string) => idempotency.get(key) ?? null),
      listVendorIssues: jest.fn(async () => [...store.values()]),
      listVisitIssues: jest.fn(async (_v: string, visitId: string) => [...store.values()].filter((i) => i.visitId === visitId)),
      listByStatus: jest.fn(async (status: string) => [...store.values()].filter((i) => i.status === status)),
    } as unknown as jest.Mocked<VendorIssuesRepository>;
    plans = { getVisitById: jest.fn().mockResolvedValue(visit) };
    access = {
      'owner-1': { role: 'owner', vendorId: 'vendor-1', active: true },
      'crew-user': { role: 'staff', vendorId: 'vendor-1', staffId: 'staff-1', active: true },
      'other-crew-user': { role: 'staff', vendorId: 'vendor-1', staffId: 'staff-2', active: true },
    };
    const vendors: OperationalAccessGateway = {
      getOperationalAccess: async (userId) => access[userId] ?? { role: 'none', active: false },
    };
    const crews: SchedulingCrewGateway = {
      listCrews: async () => [{
        crewId: 'crew-1',
        vendorId: 'vendor-1',
        name: 'Crew 1',
        vanLabel: 'Van',
        status: 'ACTIVE',
        staff: [{ staffId: 'staff-1', status: 'ACTIVE' }],
      }],
    } as unknown as SchedulingCrewGateway;
    service = new VendorIssuesService(
      issues,
      plans as unknown as CustomerPlansRepository,
      vendors,
      crews,
      () => { throw new Error('storage unused'); },
      () => NOW,
    );
  });

  const body = { type: 'EQUIPMENT_PROBLEM', description: 'Pressure washer failed', visitId: 'visit-1' };

  it('files a visit-linked issue as OPEN without touching the visit', async () => {
    const created = await service.create(req({ userId: 'crew-user', body }));
    expect(created.status).toBe('OPEN');
    expect(created.createdBy).toEqual({ userId: 'crew-user', role: 'CREW' });
    expect(created.communityId).toBe('community-1');
    expect(created.history).toHaveLength(1);
    expect(created).not.toHaveProperty('internalNotes');
    expect(plans.getVisitById).toHaveBeenCalledWith('visit-1');
    // Only issue storage is written; there is no visit write path in this service.
    expect(issues.createIssue).toHaveBeenCalledTimes(1);
  });

  it('keeps crew scoped to visits assigned to their crew', async () => {
    await expect(service.create(req({ userId: 'other-crew-user', body }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.create(req({ userId: 'crew-user', body: { type: 'OTHER', description: 'no visit' } })))
      .rejects.toMatchObject({ statusCode: 403 });
    const owner = await service.create(req({ userId: 'owner-1', key: 'k-2', body: { type: 'OTHER', description: 'general' } }));
    await expect(service.list(req({ userId: 'crew-user' }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.get(req({ userId: 'crew-user', path: { issueId: owner.issueId } })))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(service.create(req({ userId: 'stranger', body }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('replays an Idempotency-Key and refuses reuse with a different body', async () => {
    const first = await service.create(req({ userId: 'owner-1', body }));
    const replay = await service.create(req({ userId: 'owner-1', body }));
    expect(replay.issueId).toBe(first.issueId);
    expect(issues.createIssue).toHaveBeenCalledTimes(1);
    await expect(service.create(req({ userId: 'owner-1', body: { ...body, description: 'different' } })))
      .rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(service.create(req({ userId: 'owner-1', body, key: '' }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('runs ops transitions with audit history and hides internal notes from the vendor', async () => {
    const created = await service.create(req({ userId: 'owner-1', body }));
    const ops = (action: 'triage' | 'assign' | 'resolve' | 'request-action', payload: unknown) =>
      service.opsAction(req({ userId: 'admin-1', roles: ['admin'], path: { issueId: created.issueId }, body: payload }), action);

    await expect(service.opsAction(
      req({ userId: 'owner-1', path: { issueId: created.issueId }, body: {} }),
      'triage',
    )).rejects.toMatchObject({ statusCode: 403 });

    const triaged = await ops('triage', { note: 'looks like a pump fault' });
    expect(triaged.status).toBe('TRIAGED');
    expect(triaged.internalNotes).toEqual([{ at: NOW.toISOString(), by: 'admin-1', note: 'looks like a pump fault' }]);
    expect((await ops('triage', {})).history).toHaveLength(2);

    const action = await ops('request-action', { note: 'Send a photo of the pump' });
    expect(action.status).toBe('ACTION_REQUIRED');
    await expect(ops('request-action', {})).rejects.toBeDefined();

    const resolved = await ops('resolve', { outcome: 'Pump replaced', note: 'internal' });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.history.map((entry) => entry.action)).toEqual(['CREATED', 'TRIAGED', 'ACTION_REQUESTED', 'RESOLVED']);
    expect(resolved.history.every((entry) => entry.at)).toBe(true);
    await expect(ops('triage', {})).rejects.toMatchObject({ statusCode: 409 });

    const vendorView = await service.get(req({ userId: 'owner-1', path: { issueId: created.issueId } }));
    expect(vendorView).not.toHaveProperty('internalNotes');
    expect(vendorView).not.toHaveProperty('assignedTo');
    expect(vendorView.history.find((entry) => entry.by.role === 'ADMIN')?.by.userId).toBe('platform-ops');
    expect(vendorView.resolutionOutcome).toBe('Pump replaced');
  });
});
