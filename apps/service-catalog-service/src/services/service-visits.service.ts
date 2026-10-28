import { randomUUID } from 'crypto';

import {
  ConditionalWriteConflictError,
  ConflictError,
  ForbiddenError,
  LambdaRequest,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import {
  LOCATION_TYPE,
  VISIT_STATUS,
  VisitLocation,
  VisitServiceRef,
  ServiceVisitRecord,
  assertServiceVisitShape,
  assertServicesFit,
  canTransition,
  configurationsOverlap,
  transitionChange,
} from '../domain/service-visits';
import { HttpVisitAccess, VisitAccess, VisitActor } from '../domain/service-visit-access';
import {
  ServiceVisitStore,
  getServiceVisitsRepository,
} from '../repositories/service-visits.repository';
import { ServicesRepository, getServicesRepository } from '../repositories/services.repository';
import {
  locationFrom,
  parseCreate,
  parseUpdate,
  parseVersion,
  windowsFrom,
} from '../schemas/service-visits.schema';

const logger = createChildLogger(
  createLogger({ service: 'service-catalog-service', redactPII: true }),
  { component: 'ServiceVisits' },
);

export interface ServiceLookup {
  requireOwned(vendorId: string, serviceIds: string[]): Promise<VisitServiceRef[]>;
}

export class CatalogServiceLookup implements ServiceLookup {
  constructor(private readonly services: ServicesRepository = getServicesRepository()) {}

  async requireOwned(vendorId: string, serviceIds: string[]): Promise<VisitServiceRef[]> {
    const refs: VisitServiceRef[] = [];
    for (const serviceId of serviceIds) {
      const service = await this.services.findByServiceId(serviceId);
      if (!service || service.vendorId !== vendorId || service.deletedAt) {
        throw new ValidationError(`Unknown service ${serviceId}`);
      }
      if (!service.active) {
        throw new ValidationError(`Service ${serviceId} is not active`);
      }
      if (!Number.isInteger(service.durationMinutes) || service.durationMinutes < 1) {
        throw new ValidationError(`Service ${serviceId} has no duration`);
      }
      refs.push({
        serviceId,
        durationMinutes: service.durationMinutes,
        ...resourceFacts(service),
      });
    }
    return refs;
  }
}

export class ServiceVisitsService {
  constructor(
    private readonly store: ServiceVisitStore = getServiceVisitsRepository(),
    private readonly access: VisitAccess = new HttpVisitAccess(),
    private readonly services: ServiceLookup = new CatalogServiceLookup(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(request: LambdaRequest, vendorId: string) {
    const actor = await this.owner(request, vendorId);
    const input = parseCreate(request);
    const idempotencyKey = requireIdempotency(request);
    const replay = await this.store.getByIdempotency(vendorId, idempotencyKey);
    if (replay) {
      return this.require(vendorId, replay);
    }
    const windows = windowsFrom(input.windows);
    const location = locationFrom(input.location);
    const staffIds = input.staffIds ?? [];
    assertServiceVisitShape({ ...input, windows, location, staffIds }, { allowLegacyWindows: false });
    this.assertCoverage(actor, location, staffIds);
    const services = await this.services.requireOwned(vendorId, input.serviceIds);
    const timestamp = this.now().toISOString();
    const record: ServiceVisitRecord = {
      visitId: `visit_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      vendorId,
      ownerUserId: actor.userId,
      name: input.name.trim(),
      deliveryModel: input.deliveryModel,
      location,
      timezone: input.timezone,
      windows,
      serviceIds: input.serviceIds,
      services,
      staffIds,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil ?? null,
      status: VISIT_STATUS.DRAFT,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      await this.store.create(record, idempotencyKey);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const raced = await this.store.getByIdempotency(vendorId, idempotencyKey);
        if (raced) {
          return this.require(vendorId, raced);
        }
        throw new ConflictError('Service visit could not be created');
      }
      throw error;
    }
    this.log(request, 'service_visit_created', record);
    return record;
  }

  async list(request: LambdaRequest, vendorId: string, options: { limit: number; cursor?: string; status?: string }) {
    const actor = await this.access.resolve(request, vendorId);
    const records = (await this.store.list(vendorId))
      .filter((visit) => this.visible(actor, visit))
      .filter((visit) => options.status ? visit.status === options.status : visit.status !== VISIT_STATUS.ARCHIVED)
      .sort((left, right) => left.visitId.localeCompare(right.visitId));
    const start = options.cursor ? records.findIndex((visit) => visit.visitId === options.cursor) + 1 : 0;
    if (options.cursor && start <= 0) {
      throw new ValidationError('cursor is invalid');
    }
    const page = records.slice(start, start + options.limit);
    const next = records[start + options.limit];
    return { items: page, ...(next ? { nextToken: next.visitId } : {}) };
  }

  async get(request: LambdaRequest, vendorId: string, visitId: string) {
    const actor = await this.access.resolve(request, vendorId);
    const visit = await this.require(vendorId, visitId);
    if (!this.visible(actor, visit)) {
      throw new NotFoundError('Service visit not found');
    }
    return visit;
  }

  async update(request: LambdaRequest, vendorId: string, visitId: string) {
    const actor = await this.owner(request, vendorId);
    const input = parseUpdate(request);
    const current = await this.require(vendorId, visitId);
    if (current.status === VISIT_STATUS.ARCHIVED) {
      throw new ConflictError('Archived service visits cannot be edited');
    }
    const windows = input.windows ? windowsFrom(input.windows) : current.windows;
    const location = input.location ? locationFrom(input.location) : current.location;
    const staffIds = input.staffIds ?? current.staffIds;
    const serviceIds = input.serviceIds ?? current.serviceIds;
    const nextShape = {
      name: input.name ?? current.name,
      deliveryModel: input.deliveryModel ?? current.deliveryModel,
      location,
      timezone: input.timezone ?? current.timezone,
      windows,
      serviceIds,
      staffIds,
      effectiveFrom: input.effectiveFrom ?? current.effectiveFrom,
      effectiveUntil: input.effectiveUntil === undefined ? current.effectiveUntil : input.effectiveUntil,
    };
    assertServiceVisitShape(nextShape, { allowLegacyWindows: input.windows === undefined });
    this.assertCoverage(actor, location, staffIds);
    const services = input.serviceIds || current.status !== VISIT_STATUS.DRAFT
      ? await this.services.requireOwned(vendorId, serviceIds)
      : await this.services.requireOwned(vendorId, serviceIds);
    if (current.status !== VISIT_STATUS.DRAFT) {
      assertServicesFit(windows, services);
      await this.assertNoOverlap({ ...current, ...nextShape, windows, services, staffIds }, vendorId);
    }
    const next: ServiceVisitRecord = {
      ...current,
      ...nextShape,
      windows,
      services,
      staffIds,
      version: current.version + 1,
      updatedAt: this.now().toISOString(),
    };
    await this.save(next, input.expectedVersion, request, 'service_visit_updated');
    return next;
  }

  async activate(request: LambdaRequest, vendorId: string, visitId: string) {
    return this.transition(request, vendorId, visitId, VISIT_STATUS.ACTIVE, true);
  }

  async pause(request: LambdaRequest, vendorId: string, visitId: string) {
    return this.transition(request, vendorId, visitId, VISIT_STATUS.PAUSED, false);
  }

  async archive(request: LambdaRequest, vendorId: string, visitId: string) {
    return this.transition(request, vendorId, visitId, VISIT_STATUS.ARCHIVED, false);
  }

  private async transition(
    request: LambdaRequest,
    vendorId: string,
    visitId: string,
    status: ServiceVisitRecord['status'],
    validate: boolean,
  ) {
    const actor = await this.owner(request, vendorId);
    const expectedVersion = parseVersion(request).expectedVersion;
    const current = await this.require(vendorId, visitId);
    if (!canTransition(current.status, status)) {
      throw new ConflictError(`Cannot change a ${current.status} visit to ${status}`);
    }
    if (validate) {
      assertServiceVisitShape(current, { allowLegacyWindows: false });
      this.assertCoverage(actor, current.location, current.staffIds);
      const services = await this.services.requireOwned(vendorId, current.serviceIds);
      assertServicesFit(current.windows, services);
      await this.assertNoOverlap({ ...current, services }, vendorId);
      current.services = services;
    }
    const next: ServiceVisitRecord = {
      ...current,
      status,
      version: current.version + 1,
      updatedAt: this.now().toISOString(),
      ...(status === VISIT_STATUS.ARCHIVED ? { archivedAt: this.now().toISOString() } : {}),
    };
    await this.save(next, expectedVersion, request, `service_visit_${status}`);
    return next;
  }

  private async assertNoOverlap(candidate: ServiceVisitRecord, vendorId: string) {
    const visits = await this.store.list(vendorId);
    const blocking = visits.filter((visit) =>
      visit.status === VISIT_STATUS.ACTIVE || visit.status === VISIT_STATUS.PAUSED,
    );
    if (blocking.some((visit) => configurationsOverlap(candidate, visit))) {
      throw new ConflictError('This visit overlaps another active or paused visit for the same location and staff');
    }
  }

  private visible(actor: VisitActor, visit: ServiceVisitRecord): boolean {
    if (actor.role === 'admin' || actor.role === 'owner') {
      return true;
    }
    if (!actor.staffId) {
      return false;
    }
    // Visits no longer require individual staff assignment. An empty list is visible to staff.
    if (visit.staffIds.length === 0) {
      return true;
    }
    return visit.staffIds.includes(actor.staffId);
  }

  private assertCoverage(actor: VisitActor, location: VisitLocation, staffIds: string[]) {
    if (actor.role === 'admin') {
      return;
    }
    if (
      location.type === LOCATION_TYPE.COMMUNITY
      && actor.communityIds.length > 0
      && !actor.communityIds.includes(location.communityId ?? '')
    ) {
      throw new ForbiddenError('Community is not assigned to this vendor');
    }
    if (
      location.type === LOCATION_TYPE.SERVICE_AREA
      && actor.serviceAreaIds.length > 0
      && !actor.serviceAreaIds.includes(location.serviceAreaId ?? '')
    ) {
      throw new ForbiddenError('Service area is not assigned to this vendor');
    }
    if (staffIds.length > 0) {
      if (!actor.staffDirectory) {
        throw new ForbiddenError('Staff assignments could not be verified');
      }
      const unknown = staffIds.filter((id) => !actor.staffIds.includes(id));
      if (unknown.length > 0) {
        throw new ValidationError('staffIds includes a person who is not on this vendor');
      }
    }
  }

  private async owner(request: LambdaRequest, vendorId: string): Promise<VisitActor> {
    const actor = await this.access.resolve(request, vendorId);
    if (actor.role === 'staff') {
      throw new ForbiddenError('Staff cannot manage service visits');
    }
    return actor;
  }

  private async require(vendorId: string, visitId: string): Promise<ServiceVisitRecord> {
    const visit = await this.store.find(vendorId, visitId);
    if (!visit || visit.vendorId !== vendorId) {
      throw new NotFoundError('Service visit not found');
    }
    return visit;
  }

  private async save(
    next: ServiceVisitRecord,
    expectedVersion: number,
    request: LambdaRequest,
    event: string,
  ) {
    try {
      await this.store.replace(next, expectedVersion);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        this.log(request, 'service_visit_version_conflict', next);
        throw new ConflictError('This service visit was updated. Refresh and try again.');
      }
      throw error;
    }
    this.log(request, event, next);
  }

  private log(request: LambdaRequest, event: string, visit: ServiceVisitRecord) {
    logger.info({
      event,
      correlationId: request.context.correlationId,
      vendorId: visit.vendorId,
      visitId: visit.visitId,
      status: visit.status,
      version: visit.version,
    });
  }
}

function resourceFacts(service: {
  waterLiters?: number;
  requiresWater?: boolean;
  requiresVendorEquipment?: boolean;
}): Pick<VisitServiceRef, 'waterLiters' | 'requiresWater' | 'requiresVendorEquipment'> {
  const waterLiters = service.waterLiters;
  return {
    ...(Number.isInteger(waterLiters) && waterLiters !== undefined && waterLiters > 0
      ? { waterLiters }
      : {}),
    ...(service.requiresWater === true ? { requiresWater: true as const } : {}),
    ...(service.requiresVendorEquipment === true ? { requiresVendorEquipment: true as const } : {}),
  };
}

export function requireIdempotency(request: LambdaRequest): string {
  const headers = request.event?.headers ?? {};
  const key = Object.entries(headers).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1];
  if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,80}$/.test(key.trim())) {
    throw new ValidationError('Idempotency-Key header is required');
  }
  return key.trim();
}

export function snapshotOf(record: ServiceVisitRecord, previous?: ServiceVisitRecord['status']) {
  return {
    vendorId: record.vendorId,
    visitId: record.visitId,
    configurationVersion: record.version,
    occurredAt: record.updatedAt,
    change: transitionChange(previous, record.status),
    name: record.name,
    deliveryModel: record.deliveryModel,
    location: record.location,
    timezone: record.timezone,
    windows: record.windows,
    serviceIds: record.serviceIds,
    services: record.services,
    ...(record.staffIds.length ? { staffIds: record.staffIds } : {}),
    effectiveFrom: record.effectiveFrom,
    effectiveUntil: record.effectiveUntil ?? null,
    status: record.status,
  };
}

let service: ServiceVisitsService | undefined;

export function getServiceVisitsService(): ServiceVisitsService {
  if (!service) {
    service = new ServiceVisitsService();
  }
  return service;
}
