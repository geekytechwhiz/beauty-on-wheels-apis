import { ConflictError, ConditionalWriteConflictError, ForbiddenError, LambdaRequest, NotFoundError, ValidationError } from '@api-hub/utils';

import { VISIT_STATUS, ServiceVisitRecord } from '../domain/service-visits';
import { VisitActor } from '../domain/service-visit-access';
import { ServiceVisitStore } from '../repositories/service-visits.repository';
import { ServiceLookup, ServiceVisitsService } from './service-visits.service';

class MemoryStore implements ServiceVisitStore {
  visits = new Map<string, ServiceVisitRecord>();
  keys = new Map<string, string>();

  async find(vendorId: string, visitId: string) {
    const visit = this.visits.get(`${vendorId}#${visitId}`);
    return visit ? structuredClone(visit) : null;
  }

  async list(vendorId: string) {
    return [...this.visits.values()].filter((visit) => visit.vendorId === vendorId).map((visit) => structuredClone(visit));
  }

  async getByIdempotency(vendorId: string, key: string) {
    return this.keys.get(`${vendorId}#${key}`) ?? null;
  }

  async create(record: ServiceVisitRecord, idempotencyKey: string) {
    if (this.keys.has(`${record.vendorId}#${idempotencyKey}`)) {
      throw new ConditionalWriteConflictError(new Error('duplicate'));
    }
    this.visits.set(`${record.vendorId}#${record.visitId}`, structuredClone(record));
    this.keys.set(`${record.vendorId}#${idempotencyKey}`, record.visitId);
  }

  async replace(record: ServiceVisitRecord, expectedVersion: number) {
    const current = this.visits.get(`${record.vendorId}#${record.visitId}`);
    if (!current || current.version !== expectedVersion || current.status === 'archived') {
      throw new ConditionalWriteConflictError(new Error('version'));
    }
    this.visits.set(`${record.vendorId}#${record.visitId}`, structuredClone(record));
  }
}

function request(actor: Partial<VisitActor> & { userId: string }, body?: unknown, headers?: Record<string, string>): LambdaRequest {
  return {
    body,
    event: { headers: headers ?? { 'Idempotency-Key': 'create-1' } },
    context: { correlationId: 'corr-1', authContext: { userId: actor.userId, roles: [] } },
  } as unknown as LambdaRequest;
}

const owner: VisitActor = {
  userId: 'owner-1',
  role: 'owner',
  communityIds: ['community_101'],
  serviceAreaIds: ['area_1'],
  staffIds: ['staff_101', 'staff_102'],
  staffDirectory: true,
};

const body = {
  name: 'Ivy League Community Wash',
  deliveryModel: 'community',
  location: { type: 'community', communityId: 'community_101' },
  timezone: 'Asia/Kolkata',
  windows: [
    {
      windowId: 'weekday_morning',
      label: 'EARLY_MORNING',
      daysOfWeek: ['MON', 'WED', 'FRI'],
      startTime: '06:00',
      endTime: '09:00',
      endDayOffset: 0,
      capacity: { staffCount: 2 },
      resources: {
        water: { source: 'VENDOR_SUPPLIED', capacityLiters: 300 },
        equipment: { providedByVendor: true },
      },
    },
  ],
  serviceIds: ['service_exterior'],
  effectiveFrom: '2026-11-01',
  effectiveUntil: null,
};

describe('ServiceVisitsService', () => {
  const store = new MemoryStore();
  const services: ServiceLookup = {
    requireOwned: jest.fn(async (_vendorId: string, serviceIds: string[]) => {
      if (serviceIds.includes('missing')) {
        throw new ValidationError('Unknown service missing');
      }
      return serviceIds.map((serviceId) => ({ serviceId, durationMinutes: serviceId === 'service_complete' ? 90 : 60 }));
    }),
  };
  let actor = owner;
  const access = { resolve: jest.fn(async () => actor) };
  const service = new ServiceVisitsService(store, access, services, () => new Date('2026-10-25T08:00:00.000Z'));

  beforeEach(() => {
    store.visits.clear();
    store.keys.clear();
    actor = owner;
  });

  it('creates a draft and replays the same idempotency key', async () => {
    const created = await service.create(request(owner, body), 'vendor_123');
    expect(created.status).toBe(VISIT_STATUS.DRAFT);
    expect(created.version).toBe(1);
    expect(created.staffIds).toEqual([]);
    expect(created.location).toEqual({ type: 'community', communityId: 'community_101' });
    expect(created.windows[0]).toMatchObject({
      label: 'earlyMorning',
      capacity: { staffCount: 2 },
      resources: {
        water: { source: 'vendorSupplied', capacityLiters: 300 },
        equipment: { providedByVendor: true },
      },
    });
    expect(created.windows[0].maxConcurrentBookings).toBeUndefined();
    expect(created.services).toEqual([{ serviceId: 'service_exterior', durationMinutes: 60 }]);
    const replay = await service.create(request(owner, body), 'vendor_123');
    expect(replay.visitId).toBe(created.visitId);
  });

  it('rejects staff management, an uncovered community, and a branch id', async () => {
    actor = { ...owner, role: 'staff', staffId: 'staff_101' };
    await expect(service.create(request(actor, body), 'vendor_123')).rejects.toBeInstanceOf(ForbiddenError);
    actor = owner;
    await expect(service.create(request(owner, {
      ...body,
      location: { type: 'community', communityId: 'community_999' },
    }, { 'Idempotency-Key': 'community' }), 'vendor_123')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.create(request(owner, {
      ...body,
      location: { ...body.location, branchId: 'branch_001' },
    }, { 'Idempotency-Key': 'branch' }), 'vendor_123')).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an unknown service and an overlapping activation', async () => {
    await expect(service.create(request(owner, { ...body, serviceIds: ['missing'] }, { 'Idempotency-Key': 'bad' }), 'vendor_123'))
      .rejects.toBeInstanceOf(ValidationError);
    const first = await service.create(request(owner, body, { 'Idempotency-Key': 'a' }), 'vendor_123');
    await service.activate(request(owner, { expectedVersion: 1 }), 'vendor_123', first.visitId);
    const second = await service.create(request(owner, body, { 'Idempotency-Key': 'b' }), 'vendor_123');
    await expect(service.activate(request(owner, { expectedVersion: 1 }), 'vendor_123', second.visitId))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it('replaces windows and conflicts on a stale version', async () => {
    const created = await service.create(request(owner, body, { 'Idempotency-Key': 'c' }), 'vendor_123');
    const updated = await service.update(request(owner, {
      expectedVersion: 1,
      windows: [{
        ...body.windows[0],
        endTime: '10:00',
        capacity: { staffCount: 4 },
      }],
    }), 'vendor_123', created.visitId);
    expect(updated.windows).toHaveLength(1);
    expect(updated.windows[0].endTime).toBe('10:00');
    expect(updated.windows[0].capacity).toEqual({ staffCount: 4 });
    expect(updated.windows[0].maxConcurrentBookings).toBeUndefined();
    expect(updated.version).toBe(2);
    await expect(service.update(request(owner, { expectedVersion: 1, name: 'stale' }), 'vendor_123', created.visitId))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses to activate a legacy visit until resources are completed, without inventing them', async () => {
    const legacy: ServiceVisitRecord = {
      visitId: 'visit_legacy',
      vendorId: 'vendor_123',
      ownerUserId: 'owner-1',
      name: 'Saved before resources',
      deliveryModel: 'community',
      location: { type: 'community', communityId: 'community_101', branchId: 'branch_001' },
      timezone: 'Asia/Kolkata',
      windows: [{
        windowId: 'weekday_morning',
        label: 'earlyMorning',
        daysOfWeek: ['MON', 'WED', 'FRI'],
        startTime: '06:00',
        endTime: '09:00',
        endDayOffset: 0,
        maxConcurrentBookings: 2,
      }],
      serviceIds: ['service_exterior'],
      services: [{ serviceId: 'service_exterior', durationMinutes: 60 }],
      staffIds: ['staff_101'],
      effectiveFrom: '2026-11-01',
      effectiveUntil: null,
      status: VISIT_STATUS.DRAFT,
      version: 1,
      createdAt: '2026-10-25T08:00:00.000Z',
      updatedAt: '2026-10-25T08:00:00.000Z',
    };
    store.visits.set('vendor_123#visit_legacy', legacy);
    await expect(service.activate(request(owner, { expectedVersion: 1 }), 'vendor_123', legacy.visitId))
      .rejects.toBeInstanceOf(ValidationError);
    const stored = await store.find('vendor_123', legacy.visitId);
    expect(stored?.status).toBe(VISIT_STATUS.DRAFT);
    expect(stored?.windows[0].maxConcurrentBookings).toBe(2);
    expect(stored?.windows[0].capacity).toBeUndefined();
    expect(stored?.windows[0].resources).toBeUndefined();
  });

  it('lets staff view an assigned visit and hides the others', async () => {
    const created = await service.create(request(owner, { ...body, staffIds: ['staff_101'] }, { 'Idempotency-Key': 'd' }), 'vendor_123');
    actor = { ...owner, role: 'staff', staffId: 'staff_101' };
    await expect(service.get(request(actor), 'vendor_123', created.visitId)).resolves.toMatchObject({ visitId: created.visitId });
    actor = { ...owner, role: 'staff', staffId: 'staff_999' };
    await expect(service.get(request(actor), 'vendor_123', created.visitId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
