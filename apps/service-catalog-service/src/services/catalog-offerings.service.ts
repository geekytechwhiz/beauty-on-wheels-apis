import { randomUUID } from 'crypto';

import {
  BaseError,
  ConflictError,
  ConditionalWriteConflictError,
  LambdaRequest,
  NotFoundError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { env } from '../configs/env.config';
import { INITIAL_CATALOG_VERSION, nextCatalogVersion } from '../domain/catalog-version';
import {
  buildDiscoveryWritePlan,
} from '../domain/discovery-projection';
import {
  assertOfferingStatusTransition,
  isOfferingDiscoverable,
  OFFERING_STATUS,
  OFFERING_TYPE,
  type OfferingLifecycleStatus,
} from '../domain/offering-lifecycle';
import { assertVendorOwner } from '../domain/vendor-scope';
import { paiseToRupees } from '../domain/catalog-validation';
import { persistDiscoveryFacts } from '../discovery/persist-discovery-facts';
import {
  getDiscoveryFactsSource,
  type DiscoveryFactsSource,
} from '../integrations/vendor-discovery-facts';
import { resolveCallerVendor } from '../integrations/vendor-self';
import {
  CatalogOfferingsRepository,
  getCatalogOfferingsRepository,
} from '../repositories/catalog-offerings.repository';
import {
  CategoriesRepository,
  getCategoriesRepository,
} from '../repositories/categories.repository';
import {
  getPackagesRepository,
  PackagesRepository,
} from '../repositories/packages.repository';
import {
  getServicesRepository,
  ServicesRepository,
} from '../repositories/services.repository';
import {
  getOfferingCommunitiesService,
  OfferingCommunitiesService,
} from './offering-communities.service';
import {
  validateCreateOffering,
  validatePatchOffering,
  type ValidatedCreateOffering,
  type ValidatedIncludedService,
  type ValidatedPatchOffering,
} from '../schemas/offerings.schema';
import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';
import {
  OfferingEntity,
  PackageEntity,
  ServiceEntity,
} from '../utils/types/catalog-domain.types';
import { resolveVehiclePricing } from '../domain/vehicle-pricing';

const baseLogger = createLogger({
  service: 'catalog-offerings-service',
  redactPII: true,
});

export interface OfferingVisitWindowResponse {
  visitWindowId: string;
  label: string;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
}

export interface OfferingApiResponse {
  offeringId: string;
  offeringType: string;
  vendorId: string;
  categoryId: string;
  name: string;
  description?: string;
  billingPeriod: string;
  currency: string;
  vehiclePricing: Array<{
    vehicleType: string;
    price: number;
    /**
     * Total package duration across visits in the billing period for this
     * vehicle. Per-visit duration is on includedServices[].durationMinutes.
     */
    durationMinutes: number;
  }>;
  vehicleTypes: string[];
  includedServices: ValidatedIncludedService[];
  /** Package-defined preferred visit windows (not confirmed slots). */
  visitWindows?: OfferingVisitWindowResponse[];
  status: OfferingLifecycleStatus;
  active: boolean;
  version: number;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Present when the row is a legacy SERVICE/PACKAGE bridged for booking. */
  legacySource?: 'SERVICE' | 'PACKAGE';
}

export class CatalogOfferingsService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'CatalogOfferingsService',
  });

  constructor(
    private readonly offerings: CatalogOfferingsRepository = getCatalogOfferingsRepository(),
    private readonly categories: CategoriesRepository = getCategoriesRepository(),
    private readonly services: ServicesRepository = getServicesRepository(),
    private readonly packages: PackagesRepository = getPackagesRepository(),
    private readonly discoveryFacts: DiscoveryFactsSource | null = getDiscoveryFactsSource(),
    private readonly communities: OfferingCommunitiesService = getOfferingCommunitiesService(),
  ) {}

  async create(request: LambdaRequest): Promise<OfferingApiResponse> {
    const caller = await resolveCallerVendor(request);
    const body = validateCreateOffering(request);

    await this.assertCategories(body.includedServices);
    await this.assertNameUnique(body.name, caller.vendorId);

    const now = new Date().toISOString();
    const offeringId = randomUUID();
    const entity = buildOfferingEntity(offeringId, caller.vendorId, body, now);

    try {
      await this.offerings.createOffering(entity);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('An offering with this identity already exists');
      }
      throw error;
    }

    if (body.communityIds && body.communityIds.length > 0) {
      try {
        await this.communities.addCommunities(
          offeringAsServiceProjection(entity),
          body.communityIds,
        );
      } catch (error) {
        this.logger.warn({
          event: 'offering_community_attach_failed',
          offeringId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    await this.syncDiscovery(entity);

    this.logger.info({
      event: 'offering_created',
      offeringId,
      vendorId: caller.vendorId,
      offeringType: entity.offeringType,
      status: entity.status,
    });

    return mapOffering(entity);
  }

  async getById(request: LambdaRequest): Promise<OfferingApiResponse> {
    const offeringId = requiredParam(request, 'offeringId');
    const consistent = readConsistent(request);
    const callerVendorId = await optionalCallerVendorId(request);

    const modern = await this.offerings.findById(offeringId, consistent);
    if (modern) {
      const isOwner = callerVendorId !== undefined && modern.vendorId === callerVendorId;
      if (modern.status === OFFERING_STATUS.ARCHIVED && !isOwner) {
        throw new NotFoundError(`Offering not found: ${offeringId}`);
      }
      if (!isOwner && modern.status !== OFFERING_STATUS.PUBLISHED) {
        throw new NotFoundError(`Offering not found: ${offeringId}`);
      }
      return mapOffering(modern);
    }

    return this.loadLegacyOffering(offeringId, callerVendorId, consistent);
  }

  async patch(request: LambdaRequest): Promise<OfferingApiResponse> {
    const offeringId = requiredParam(request, 'offeringId');
    const caller = await resolveCallerVendor(request);
    const body = validatePatchOffering(request);

    const existing = await this.requireOwnedOffering(offeringId, caller.vendorId);
    if (existing.status === OFFERING_STATUS.ARCHIVED) {
      throw new ConflictError('Archived offerings cannot be updated');
    }

    if (body.includedServices) {
      await this.assertCategories(body.includedServices);
    }
    if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertNameUnique(body.name, caller.vendorId);
    }
    if (body.status) {
      assertOfferingStatusTransition(existing.status, body.status);
    }
    assertPatchBillingPeriodCopy(existing, body);
    const nextStatus = body.status ?? existing.status;
    const nextWindows = body.visitWindows ?? existing.visitWindows;
    if (nextStatus === OFFERING_STATUS.PUBLISHED && (!nextWindows || nextWindows.length === 0)) {
      throw new BaseError(
        'Published package offerings require visitWindows preferences',
        400,
        'VISIT_WINDOWS_REQUIRED',
      );
    }

    const expectedVersion = body.expectedVersion ?? existing.version;
    if (expectedVersion !== existing.version) {
      throw new ConflictError('Offering version conflict. Refresh and retry.');
    }

    const now = new Date().toISOString();
    const updated = mergeOffering(existing, body, now);

    try {
      await this.offerings.updateOffering(updated, existing.version);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Offering was modified concurrently. Please retry.');
      }
      throw error;
    }

    await this.syncDiscovery(updated);

    this.logger.info({
      event: 'offering_updated',
      offeringId,
      vendorId: caller.vendorId,
      version: updated.version,
      status: updated.status,
    });

    return mapOffering(updated);
  }

  async archive(request: LambdaRequest): Promise<{ offeringId: string; status: string }> {
    const offeringId = requiredParam(request, 'offeringId');
    const caller = await resolveCallerVendor(request);
    const existing = await this.requireOwnedOffering(offeringId, caller.vendorId);

    if (existing.status === OFFERING_STATUS.ARCHIVED) {
      return { offeringId, status: OFFERING_STATUS.ARCHIVED };
    }

    assertOfferingStatusTransition(existing.status, OFFERING_STATUS.ARCHIVED);
    const now = new Date().toISOString();
    const archived = mergeOffering(
      existing,
      { status: OFFERING_STATUS.ARCHIVED },
      now,
    );

    try {
      await this.offerings.archiveOffering(archived, existing.version);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Offering was modified concurrently. Please retry.');
      }
      throw error;
    }

    await this.syncDiscovery(archived);

    this.logger.info({
      event: 'offering_archived',
      offeringId,
      vendorId: caller.vendorId,
    });

    return { offeringId, status: OFFERING_STATUS.ARCHIVED };
  }

  async listMine(request: LambdaRequest): Promise<{
    items: OfferingApiResponse[];
    nextToken?: string;
    total: number;
  }> {
    const caller = await resolveCallerVendor(request);
    const status = optionalString(request.params?.status ?? request.query?.status);
    const limit = parseOptionalLimit(request.params?.limit ?? request.query?.limit);
    const lastEvaluatedKey = decodeNextToken(
      request.params?.nextToken ?? request.query?.nextToken,
    );

    const page = await this.offerings.listByVendor(caller.vendorId, {
      ...(status ? { status } : {}),
      limit,
      lastEvaluatedKey,
    });

    const items = page.items.map(mapOffering);
    return {
      items,
      total: items.length,
      ...(page.lastEvaluatedKey
        ? {
            nextToken: Buffer.from(JSON.stringify(page.lastEvaluatedKey)).toString('base64'),
          }
        : {}),
    };
  }

  private async requireOwnedOffering(
    offeringId: string,
    vendorId: string,
  ): Promise<OfferingEntity> {
    const entity = await this.offerings.findById(offeringId, true);
    if (!entity) {
      throw new NotFoundError(`Offering not found: ${offeringId}`);
    }
    assertVendorOwner(entity.vendorId, vendorId, 'Offering', offeringId);
    return entity;
  }

  private async assertCategories(
    included: readonly ValidatedIncludedService[],
  ): Promise<void> {
    const unique = [...new Set(included.map((item) => item.categoryId))];
    for (const categoryId of unique) {
      const category = await this.categories.findById(categoryId);
      if (!category) {
        throw new NotFoundError(`Category not found: ${categoryId}`);
      }
      if (!category.active) {
        throw new ConflictError(`Category is not active: ${categoryId}`);
      }
    }
  }

  private async assertNameUnique(name: string, vendorId: string): Promise<void> {
    const duplicate = await this.offerings.findByName(name, vendorId);
    if (duplicate && duplicate.status !== OFFERING_STATUS.ARCHIVED) {
      throw new ConflictError(`An offering named "${name}" already exists for this vendor`);
    }
  }

  private async syncDiscovery(entity: OfferingEntity): Promise<void> {
    try {
      await this.rememberDiscoveryFacts(entity.vendorId);
      const projection = offeringAsServiceProjection(entity);
      const [vendor, branches, price, existingPointers] = await Promise.all([
        this.services.getVendorDiscoveryState(entity.vendorId),
        this.services.listBranchDiscoveryStates(entity.vendorId),
        this.services.getPriceDiscoveryState(entity.vendorId, entity.offeringId),
        this.services.listDiscoveryPointers(entity.offeringId),
      ]);
      const plan = buildDiscoveryWritePlan({
        service: projection,
        vendor,
        branches,
        price,
        existingPointers,
      });
      await this.services.replaceDiscovery(plan);
    } catch (error) {
      this.logger.warn({
        event: 'offering_discovery_sync_failed',
        offeringId: entity.offeringId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async rememberDiscoveryFacts(vendorId: string): Promise<void> {
    if (!this.discoveryFacts) {
      return;
    }
    try {
      const snapshot = await this.discoveryFacts.load(vendorId);
      if (snapshot) {
        await persistDiscoveryFacts(this.services, snapshot);
      }
    } catch (error) {
      this.logger.warn({
        event: 'discovery_facts_unavailable',
        vendorId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Booking and vendor enablement still reference legacy SERVICE/PACKAGE ids.
   * Detail reads bridge those rows so removing `/services` and `/packages`
   * HTTP does not break existing bookings.
   */
  private async loadLegacyOffering(
    offeringId: string,
    callerVendorId: string | undefined,
    consistent: boolean,
  ): Promise<OfferingApiResponse> {
    const service = await this.services.findByServiceId(offeringId, consistent);
    if (service) {
      const isOwner = callerVendorId !== undefined && service.vendorId === callerVendorId;
      if (!service.active && !isOwner) {
        throw new NotFoundError(`Offering not found: ${offeringId}`);
      }
      return mapLegacyService(service);
    }

    const pkg = await this.packages.findById(offeringId);
    if (pkg) {
      const isOwner = callerVendorId !== undefined && pkg.vendorId === callerVendorId;
      if (!pkg.active && !isOwner) {
        throw new NotFoundError(`Offering not found: ${offeringId}`);
      }
      const items = await this.packages.listPackageItems(offeringId);
      return mapLegacyPackage(pkg, items.map((item) => item.refId));
    }

    throw new NotFoundError(`Offering not found: ${offeringId}`);
  }
}

function buildOfferingEntity(
  offeringId: string,
  vendorId: string,
  input: ValidatedCreateOffering,
  now: string,
): OfferingEntity {
  const categoryId = input.includedServices[0].categoryId;
  const vehicleTypes = input.vehiclePricing.map((entry) => entry.vehicleType);
  const basePrice = Math.min(...input.vehiclePricing.map((entry) => entry.price));
  const durationMinutes = Math.min(
    ...input.vehiclePricing.map((entry) => entry.durationMinutes),
  );
  const active = isOfferingDiscoverable(input.status);

  return {
    PK: CatalogKeyBuilder.offeringPk(offeringId),
    SK: CatalogKeyBuilder.offeringSk(),
    entityType: 'OFFERING',
    offeringId,
    offeringType: input.offeringType,
    vendorId,
    categoryId,
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
    billingPeriod: input.billingPeriod,
    currency: input.currency,
    vehiclePricing: input.vehiclePricing.map((entry) => ({ ...entry })),
    vehicleTypes,
    basePrice,
    durationMinutes,
    includedServices: input.includedServices.map((entry) => ({ ...entry })),
    ...(input.visitWindows === undefined
      ? {}
      : { visitWindows: input.visitWindows.map((entry) => ({ ...entry })) }),
    status: input.status,
    active,
    version: INITIAL_CATALOG_VERSION,
    displayOrder: input.displayOrder,
    GSI1PK: CatalogKeyBuilder.gsi1pk(input.name),
    GSI1SK: CatalogKeyBuilder.gsi1VendorSk('OFFERING', vendorId),
    GSI2PK: CatalogKeyBuilder.vendorPk(vendorId),
    GSI2SK: CatalogKeyBuilder.vendorOfferingSk(offeringId),
    LSI1SK: CatalogKeyBuilder.lsi1sk(input.displayOrder),
    LSI2SK: CatalogKeyBuilder.lsi2sk(active),
    LSI3SK: CatalogKeyBuilder.lsi3sk('OFFERING'),
    LSI5SK: CatalogKeyBuilder.lsi5sk(durationMinutes),
    createdAt: now,
    updatedAt: now,
  };
}

function mergeOffering(
  existing: OfferingEntity,
  updates: ValidatedPatchOffering,
  now: string,
): OfferingEntity {
  const name = updates.name ?? existing.name;
  const includedServices = updates.includedServices ?? existing.includedServices;
  const vehiclePricing = updates.vehiclePricing ?? existing.vehiclePricing;
  const status = updates.status ?? existing.status;
  const displayOrder = updates.displayOrder ?? existing.displayOrder;
  const billingPeriod = updates.billingPeriod ?? existing.billingPeriod;
  const currency = updates.currency ?? existing.currency;
  const description = updates.description ?? existing.description;
  const visitWindows = updates.visitWindows ?? existing.visitWindows;
  const categoryId = includedServices[0]?.categoryId ?? existing.categoryId;
  const vehicleTypes = vehiclePricing.map((entry) => entry.vehicleType);
  const basePrice = Math.min(...vehiclePricing.map((entry) => entry.price));
  const durationMinutes = Math.min(...vehiclePricing.map((entry) => entry.durationMinutes));
  const active = isOfferingDiscoverable(status);

  const versionRelevant =
    (updates.name !== undefined && updates.name !== existing.name)
    || (updates.description !== undefined && updates.description !== existing.description)
    || (updates.billingPeriod !== undefined && updates.billingPeriod !== existing.billingPeriod)
    || (updates.currency !== undefined && updates.currency !== existing.currency)
    || (updates.vehiclePricing !== undefined)
    || (updates.includedServices !== undefined)
    || (updates.visitWindows !== undefined)
    || (updates.status !== undefined && updates.status !== existing.status);

  return {
    ...existing,
    name,
    description,
    billingPeriod,
    currency,
    categoryId,
    vehiclePricing: vehiclePricing.map((entry) => ({ ...entry })),
    vehicleTypes,
    basePrice,
    durationMinutes,
    includedServices: includedServices.map((entry) => ({ ...entry })),
    ...(visitWindows === undefined
      ? {}
      : { visitWindows: visitWindows.map((entry) => ({ ...entry })) }),
    status,
    active,
    displayOrder,
    version: nextCatalogVersion(existing.version, versionRelevant),
    GSI1PK: CatalogKeyBuilder.gsi1pk(name),
    GSI1SK: CatalogKeyBuilder.gsi1VendorSk('OFFERING', existing.vendorId),
    GSI2PK: CatalogKeyBuilder.vendorPk(existing.vendorId),
    GSI2SK: CatalogKeyBuilder.vendorOfferingSk(existing.offeringId),
    LSI1SK: CatalogKeyBuilder.lsi1sk(displayOrder),
    LSI2SK: CatalogKeyBuilder.lsi2sk(active),
    LSI5SK: CatalogKeyBuilder.lsi5sk(durationMinutes),
    updatedAt: now,
  };
}

/** Discovery/pricing helpers expect ServiceEntity-shaped prices in major units. */
function offeringAsServiceProjection(offering: OfferingEntity): ServiceEntity {
  const vehiclePricing = offering.vehiclePricing.map((entry) => ({
    vehicleType: entry.vehicleType,
    price: paiseToRupees(entry.price),
    durationMinutes: entry.durationMinutes,
  }));
  return {
    PK: CatalogKeyBuilder.categoryPk(offering.categoryId),
    SK: CatalogKeyBuilder.serviceSk(offering.offeringId),
    entityType: 'SERVICE',
    vendorId: offering.vendorId,
    categoryId: offering.categoryId,
    serviceId: offering.offeringId,
    name: offering.name,
    description: offering.description,
    vehiclePricing,
    durationMinutes: offering.durationMinutes,
    vehicleTypes: [...offering.vehicleTypes],
    basePrice: paiseToRupees(offering.basePrice),
    displayOrder: offering.displayOrder,
    active: offering.active,
    version: offering.version,
    createdAt: offering.createdAt,
    updatedAt: offering.updatedAt,
  };
}

function mapOffering(entity: OfferingEntity): OfferingApiResponse {
  return {
    offeringId: entity.offeringId,
    offeringType: entity.offeringType,
    vendorId: entity.vendorId,
    categoryId: entity.categoryId,
    name: entity.name,
    ...(entity.description === undefined ? {} : { description: entity.description }),
    billingPeriod: entity.billingPeriod,
    currency: entity.currency,
    vehiclePricing: entity.vehiclePricing.map((entry) => ({ ...entry })),
    vehicleTypes: [...entity.vehicleTypes],
    includedServices: entity.includedServices.map((entry) => ({ ...entry })),
    ...(entity.visitWindows === undefined
      ? {}
      : { visitWindows: entity.visitWindows.map((entry) => ({ ...entry })) }),
    status: entity.status,
    active: entity.active,
    version: entity.version,
    displayOrder: entity.displayOrder,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function assertPatchBillingPeriodCopy(
  existing: OfferingEntity,
  updates: ValidatedPatchOffering,
): void {
  const nextStatus = updates.status ?? existing.status;
  const copyChanged =
    updates.name !== undefined
    || updates.description !== undefined
    || updates.billingPeriod !== undefined;
  const publishing = nextStatus === OFFERING_STATUS.PUBLISHED
    && (copyChanged || existing.status !== OFFERING_STATUS.PUBLISHED);
  if (!copyChanged && !publishing) {
    return;
  }
  const billingPeriod = updates.billingPeriod ?? existing.billingPeriod;
  const name = updates.name ?? existing.name;
  const description = updates.description ?? existing.description;
  const haystack = `${name} ${description ?? ''}`.toLowerCase();
  const conflicts: Record<string, string[]> = {
    weekly: ['daily', 'every day', 'per day'],
    monthly: ['daily', 'weekly', 'every week', 'per week'],
    yearly: ['daily', 'weekly', 'monthly', 'every month', 'per month'],
    oneTime: ['daily', 'weekly', 'monthly', 'yearly', 'subscription', 'recurring'],
  };
  const tokens = conflicts[billingPeriod] ?? [];
  const hit = tokens.find((token) => haystack.includes(token));
  if (hit) {
    throw new BaseError(
      `Offering copy mentions "${hit}" which conflicts with billingPeriod ${billingPeriod}`,
      400,
      'BILLING_PERIOD_COPY_CONFLICT',
    );
  }
}

function mapLegacyService(entity: ServiceEntity): OfferingApiResponse {
  const vehiclePricing = resolveVehiclePricing(entity).map((entry) => ({
    vehicleType: entry.vehicleType,
    /** Bridge legacy major-unit prices into minor units for the unified contract. */
    price: Math.round(entry.price * 100),
    durationMinutes: entry.durationMinutes,
  }));
  return {
    offeringId: entity.serviceId,
    offeringType: OFFERING_TYPE.SERVICE,
    vendorId: entity.vendorId,
    categoryId: entity.categoryId,
    name: entity.name,
    ...(entity.description === undefined ? {} : { description: entity.description }),
    billingPeriod: 'oneTime',
    currency: 'INR',
    vehiclePricing,
    vehicleTypes: vehiclePricing.map((entry) => entry.vehicleType),
    includedServices: [{
      name: entity.name,
      ...(entity.description === undefined ? {} : { description: entity.description }),
      categoryId: entity.categoryId,
      visitsPerPeriod: 1,
      durationMinutes: entity.durationMinutes,
    }],
    status: entity.active ? OFFERING_STATUS.PUBLISHED : OFFERING_STATUS.PAUSED,
    active: entity.active,
    version: entity.version ?? INITIAL_CATALOG_VERSION,
    displayOrder: entity.displayOrder,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    legacySource: 'SERVICE',
  };
}

function mapLegacyPackage(
  entity: PackageEntity,
  refIds: string[],
): OfferingApiResponse {
  const priceMinor = Math.round(entity.discountedPrice * 100);
  return {
    offeringId: entity.packageId,
    offeringType: OFFERING_TYPE.PACKAGE,
    vendorId: entity.vendorId,
    categoryId: 'legacy',
    name: entity.name,
    ...(entity.description === undefined ? {} : { description: entity.description }),
    billingPeriod: 'oneTime',
    currency: 'INR',
    vehiclePricing: [{
      vehicleType: 'SEDAN',
      price: priceMinor,
      durationMinutes: 60,
    }],
    vehicleTypes: ['SEDAN'],
    includedServices: refIds.map((refId) => ({
      name: refId,
      categoryId: 'legacy',
      visitsPerPeriod: 1,
      durationMinutes: 60,
    })),
    status: entity.active ? OFFERING_STATUS.PUBLISHED : OFFERING_STATUS.PAUSED,
    active: entity.active,
    version: entity.version ?? INITIAL_CATALOG_VERSION,
    displayOrder: entity.displayOrder,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    legacySource: 'PACKAGE',
  };
}

function requiredParam(request: LambdaRequest, name: string): string {
  const value = request.params?.[name] ?? request.pathParameters?.[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new BaseError(`${name} is required`, 400, 'VALIDATION_ERROR');
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readConsistent(request: LambdaRequest): boolean {
  const value = request.params?.consistent ?? request.query?.consistent;
  return value === true || value === 'true';
}

async function optionalCallerVendorId(
  request: LambdaRequest,
): Promise<string | undefined> {
  if (!env.VENDOR_BASE_URL?.trim()) {
    return undefined;
  }
  const authorization = request.event?.headers
    && Object.entries(request.event.headers).find(
      ([key, value]) => key.toLowerCase() === 'authorization' && typeof value === 'string',
    )?.[1];
  if (!authorization) {
    return undefined;
  }
  try {
    const caller = await resolveCallerVendor(request);
    return caller.vendorId;
  } catch {
    return undefined;
  }
}

function parseOptionalLimit(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new BaseError('limit must be an integer between 1 and 100', 400, 'VALIDATION_ERROR');
  }
  return parsed;
}

function decodeNextToken(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new BaseError('Invalid nextToken', 400, 'VALIDATION_ERROR');
  }
}

let service: CatalogOfferingsService | undefined;

export function getCatalogOfferingsService(): CatalogOfferingsService {
  if (!service) {
    service = new CatalogOfferingsService();
  }
  return service;
}
