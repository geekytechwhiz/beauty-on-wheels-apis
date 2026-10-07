import { LambdaRequest } from '@api-hub/utils';
import {
  ConditionalWriteConflictError,
  ConflictError,
  NotFoundError,
  ValidationError,
  isConditionalWriteConflictAtIndex,
} from '@api-hub/utils';
import { createLogger, createChildLogger } from '@api-hub/observability';

import {
  CapabilitiesRepository,
  getCapabilitiesRepository,
} from '../repositories/capabilities.repository';
import {
  VendorsRepository,
  getVendorsRepository,
} from '../repositories/vendors.repository';
import { CapabilitiesMapper } from '../mappers/capabilities.mapper';
import {
  AvailableCapabilities,
  ReplaceVendorPackagesRequest,
  ReplaceVendorServicesRequest,
  UpdateVendorCapabilitiesRequest,
  VehicleType,
  VendorCapabilities,
  VendorPackageOffering,
  VendorServiceOffering,
} from '../types/api-types';
import {
  CAPABILITY_CATALOG_SOURCE,
  isKnownVehicleType,
  listAvailableCapabilities,
} from '../domain/capabilities-catalog';
import {
  MAX_CATALOG_MAPPINGS,
  PackageOfferingInput,
  assertMoneyAmount,
  findDuplicateId,
  isCatalogId,
} from '../domain/catalog-mapping';
import {
  CatalogEntityLookup,
  getCatalogEntityLookup,
} from '../integrations/catalog-entity-lookup';
import {
  VendorPackageOfferingRecord,
  VendorServiceOfferingRecord,
} from '../types/repository.types';
import {
  assertVendorAccess,
  getAuthenticatedUserId,
  getVendorId,
} from '../utils/helpers';

const baseLogger = createLogger({
  service: 'capabilities-service',
  redactPII: true,
});

export class CapabilitiesService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'CapabilitiesService',
  });

  constructor(
    private readonly repository: CapabilitiesRepository = getCapabilitiesRepository(),
    private readonly vendorsRepository: VendorsRepository = getVendorsRepository(),
    private readonly catalog: CatalogEntityLookup = getCatalogEntityLookup(),
  ) {}

  private async requireAccessibleVendor(request: LambdaRequest, vendorId: string) {
    const item = await this.vendorsRepository.getVendorById(vendorId);
    if (!item) {
      throw new NotFoundError('Vendor not found');
    }
    assertVendorAccess(request, item);
    return item;
  }

  async listavailablecapabilities(
    request: LambdaRequest,
  ): Promise<AvailableCapabilities> {
    getAuthenticatedUserId(request);
    return {
      vehicleTypes: listAvailableCapabilities(),
      catalogSources: { ...CAPABILITY_CATALOG_SOURCE },
    };
  }

  async getvendorcapabilities(
    request: LambdaRequest,
  ): Promise<VendorCapabilities> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);

    this.logger.info({
      event: 'getvendorcapabilities_start',
      userId,
      vendorId,
    });

    await this.requireAccessibleVendor(request, vendorId);
    const item = await this.repository.getCapabilities(vendorId);
    const result = item
      ? CapabilitiesMapper.toDomain(item)
      : CapabilitiesMapper.empty(vendorId);

    this.logger.info({
      event: 'getvendorcapabilities_success',
      userId,
      vendorId,
    });

    return result;
  }

  async updatevendorcapabilities(
    request: LambdaRequest,
  ): Promise<VendorCapabilities> {
    const userId = getAuthenticatedUserId(request);
    const vendorId = getVendorId(request);
    const body = request.body as UpdateVendorCapabilitiesRequest;

    this.logger.info({
      event: 'VendorCapabilityUpdated',
      outcome: 'start',
      userId,
      vendorId,
    });

    await this.requireAccessibleVendor(request, vendorId);
    const existing = await this.repository.getCapabilities(vendorId);

    const services = this.resolveServices(body);
    const packages = this.resolvePackages(body);
    await this.validateCatalog(request, services, packages);

    const ddbItem = CapabilitiesMapper.toDdbItem({
      vendorId,
      vehicleTypes: this.normalizeVehicleTypes(body.vehicleTypes),
      services,
      packages,
      createdAt: existing?.createdAt,
    });

    await this.persist(ddbItem, existing?.updatedAt, vendorId, userId);
    return CapabilitiesMapper.toDomain(ddbItem);
  }

  async getvendorservices(
    request: LambdaRequest,
  ): Promise<{ data: VendorServiceOffering[] }> {
    const capabilities = await this.getvendorcapabilities(request);
    return { data: capabilities.services ?? [] };
  }

  async updatevendorservices(
    request: LambdaRequest,
  ): Promise<{ data: VendorServiceOffering[] }> {
    const vendorId = getVendorId(request);
    const userId = getAuthenticatedUserId(request);
    const body = request.body as ReplaceVendorServicesRequest;

    this.logger.info({
      event: 'VendorCatalogMappingUpdated',
      outcome: 'start',
      userId,
      vendorId,
      mapping: 'services',
    });

    await this.requireAccessibleVendor(request, vendorId);
    const existing = await this.repository.getCapabilities(vendorId);
    const services = this.normalizeServices(body.services ?? []);
    const packages = existing
      ? CapabilitiesMapper.packagesFromItem(existing)
      : [];
    await this.validateCatalog(request, services, []);

    const ddbItem = CapabilitiesMapper.toDdbItem({
      vendorId,
      vehicleTypes: existing?.vehicleTypes ?? [],
      services,
      packages,
      createdAt: existing?.createdAt,
    });
    await this.persist(ddbItem, existing?.updatedAt, vendorId, userId);
    return { data: CapabilitiesMapper.toDomain(ddbItem).services ?? [] };
  }

  async getvendorpackages(
    request: LambdaRequest,
  ): Promise<{ data: VendorPackageOffering[] }> {
    const capabilities = await this.getvendorcapabilities(request);
    return { data: capabilities.packages ?? [] };
  }

  async updatevendorpackages(
    request: LambdaRequest,
  ): Promise<{ data: VendorPackageOffering[] }> {
    const vendorId = getVendorId(request);
    const userId = getAuthenticatedUserId(request);
    const body = request.body as ReplaceVendorPackagesRequest;

    this.logger.info({
      event: 'VendorCatalogMappingUpdated',
      outcome: 'start',
      userId,
      vendorId,
      mapping: 'packages',
    });

    await this.requireAccessibleVendor(request, vendorId);
    const existing = await this.repository.getCapabilities(vendorId);
    const services = existing
      ? CapabilitiesMapper.servicesFromItem(existing)
      : [];
    const packages = this.normalizePackages(body.packages ?? []);
    await this.validateCatalog(request, [], packages);

    const ddbItem = CapabilitiesMapper.toDdbItem({
      vendorId,
      vehicleTypes: existing?.vehicleTypes ?? [],
      services,
      packages,
      createdAt: existing?.createdAt,
    });
    await this.persist(ddbItem, existing?.updatedAt, vendorId, userId);
    return { data: CapabilitiesMapper.toDomain(ddbItem).packages ?? [] };
  }

  private async persist(
    ddbItem: ReturnType<typeof CapabilitiesMapper.toDdbItem>,
    expectedUpdatedAt: string | undefined,
    vendorId: string,
    userId: string,
  ) {
    try {
      await this.repository.putCapabilities(ddbItem, expectedUpdatedAt);
    } catch (err) {
      if (isConditionalWriteConflictAtIndex(err, 0)) {
        throw new NotFoundError('Vendor not found');
      }
      if (isConditionalWriteConflictAtIndex(err, 1)) {
        throw new ConflictError('Vendor capabilities update conflict');
      }
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Vendor capabilities update conflict');
      }
      throw err;
    }

    this.logger.info({
      event: 'VendorCapabilityUpdated',
      outcome: 'success',
      userId,
      vendorId,
      serviceCount: ddbItem.serviceIds.length,
      packageCount: ddbItem.packageIds.length,
    });
  }

  private resolveServices(
    body: UpdateVendorCapabilitiesRequest,
  ): VendorServiceOfferingRecord[] {
    if ((body.serviceIds?.length ?? 0) > 0 && !body.services) {
      throw new ValidationError(
        'Catalog service mappings require categoryId. Send services[] with serviceId and categoryId.',
      );
    }
    if (body.services) {
      return this.normalizeServices(body.services);
    }
    return [];
  }

  private resolvePackages(
    body: UpdateVendorCapabilitiesRequest,
  ): VendorPackageOfferingRecord[] {
    if (body.packages) {
      return this.normalizePackages(body.packages);
    }
    if (body.packageIds?.length) {
      return this.normalizePackages(
        body.packageIds.map((packageId) => ({ packageId, enabled: true })),
      );
    }
    return [];
  }

  private normalizeVehicleTypes(values: VehicleType[] | undefined): VehicleType[] {
    const vehicleTypes = values ?? [];
    for (const value of vehicleTypes) {
      if (!isKnownVehicleType(value)) {
        throw new ValidationError(`Unknown vehicle type: ${value}`);
      }
    }
    return [...new Set(vehicleTypes)];
  }

  private normalizeServices(
    services: Array<{
      serviceId: string;
      categoryId?: string;
      enabled?: boolean;
      priceOverride?: number;
    }>,
  ): VendorServiceOfferingRecord[] {
    if (services.length > MAX_CATALOG_MAPPINGS) {
      throw new ValidationError(
        `A vendor can map at most ${MAX_CATALOG_MAPPINGS} services`,
      );
    }
    const duplicate = findDuplicateId(services.map((entry) => entry.serviceId));
    if (duplicate) {
      throw new ConflictError(`Duplicate service mapping: ${duplicate}`);
    }

    return services.map((entry) => {
      const serviceId = entry.serviceId?.trim();
      const categoryId = entry.categoryId?.trim();
      if (!serviceId || !isCatalogId(serviceId)) {
        throw new ValidationError(`Invalid catalog service id: ${entry.serviceId}`);
      }
      if (!categoryId || !isCatalogId(categoryId)) {
        throw new ValidationError(
          `Invalid catalog category id for service ${serviceId}`,
        );
      }
      if (entry.priceOverride !== undefined) {
        assertMoneyAmount(entry.priceOverride, 'priceOverride');
      }
      return {
        serviceId,
        categoryId,
        enabled: entry.enabled !== false,
        ...(entry.priceOverride !== undefined
          ? { priceOverride: entry.priceOverride }
          : {}),
      };
    });
  }

  private normalizePackages(
    packages: PackageOfferingInput[],
  ): VendorPackageOfferingRecord[] {
    if (packages.length > MAX_CATALOG_MAPPINGS) {
      throw new ValidationError(
        `A vendor can map at most ${MAX_CATALOG_MAPPINGS} packages`,
      );
    }
    const duplicate = findDuplicateId(packages.map((entry) => entry.packageId));
    if (duplicate) {
      throw new ConflictError(`Duplicate package mapping: ${duplicate}`);
    }

    return packages.map((entry) => {
      const packageId = entry.packageId?.trim();
      if (!packageId || !isCatalogId(packageId)) {
        throw new ValidationError(`Invalid catalog package id: ${entry.packageId}`);
      }
      if (entry.priceOverride !== undefined) {
        assertMoneyAmount(entry.priceOverride, 'priceOverride');
      }
      return {
        packageId,
        enabled: entry.enabled !== false,
        ...(entry.priceOverride !== undefined
          ? { priceOverride: entry.priceOverride }
          : {}),
      };
    });
  }

  private async validateCatalog(
    request: LambdaRequest,
    services: readonly VendorServiceOfferingRecord[],
    packages: readonly VendorPackageOfferingRecord[],
  ) {
    const authorizationHeader = readAuthorization(request);
    const servicesToCheck = services.filter(
      (entry): entry is VendorServiceOfferingRecord & { categoryId: string } =>
        Boolean(entry.categoryId),
    );
    await this.catalog.assertServicesExist(
      servicesToCheck.map((entry) => ({
        serviceId: entry.serviceId,
        categoryId: entry.categoryId,
        enabled: entry.enabled,
      })),
      authorizationHeader,
    );
    await this.catalog.assertPackagesExist(
      packages.map((entry) => ({
        packageId: entry.packageId,
        enabled: entry.enabled,
      })),
      authorizationHeader,
    );
  }
}

function readAuthorization(request: LambdaRequest): string | undefined {
  const fromContext = request.context?.authHeader ?? request.context?.userContext?.authHeader;
  if (typeof fromContext === 'string' && fromContext.trim()) {
    return fromContext;
  }
  const headers = request.event?.headers ?? {};
  const value = headers.Authorization ?? headers.authorization;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

let service: CapabilitiesService;

export function getCapabilitiesService() {
  if (!service) {
    service = new CapabilitiesService();
  }

  return service;
}
