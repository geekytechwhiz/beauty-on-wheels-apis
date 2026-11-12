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
  UpdateVendorCapabilitiesRequest,
  VehicleType,
  VendorCapabilities,
} from '../types/api-types';
import {
  CAPABILITY_CATALOG_SOURCE,
  CAPABILITY_CATEGORY,
  isKnownServiceType,
  isKnownVehicleType,
  listCapabilitiesByCategory,
  listCapabilityCategories,
  resolveWashMethodId,
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
import { assignPricingConfiguration } from '../domain/pricing-configuration';
import {
  VendorCapabilitiesDdbItem,
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
      categories: listCapabilityCategories(),
      // Per-category lists are kept alongside `categories`; `vehicleTypes` is the legacy key.
      vehicleTypes: listCapabilitiesByCategory(CAPABILITY_CATEGORY.VEHICLE_TYPE),
      washMethods: listCapabilitiesByCategory(CAPABILITY_CATEGORY.WASH_METHOD),
      serviceTypes: listCapabilitiesByCategory(CAPABILITY_CATEGORY.SERVICE_TYPE),
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

  /**
   * Builds the capabilities item for initial vendor creation. Does not persist
   * and does not require the vendor row to exist yet. Prices are never accepted.
   */
  async buildInitialCapabilities(
    vendorId: string,
    body: {
      vehicleTypes: VehicleType[];
      serviceIds: string[];
      packageIds: string[];
      washMethodIds: string[];
    },
    request: LambdaRequest,
  ): Promise<VendorCapabilitiesDdbItem> {
    const duplicateVehicle = findDuplicateId(body.vehicleTypes);
    if (duplicateVehicle) {
      throw new ValidationError(`Duplicate vehicle type: ${duplicateVehicle}`);
    }
    const services = this.normalizeServices(
      body.serviceIds.map((serviceId) => ({ serviceId, categoryId: serviceId, enabled: true })),
    ).map((entry) => ({ serviceId: entry.serviceId, enabled: true }));
    const packages = this.normalizePackages(
      body.packageIds.map((packageId) => ({ packageId, enabled: true })),
    ).map((entry) => ({ packageId: entry.packageId, enabled: true }));
    // await this.catalog.assertServicesExist(
    //   services.map((entry) => ({
    //     serviceId: entry.serviceId,
    //     categoryId: entry.serviceId,
    //     enabled: true,
    //   })),
    //   readAuthorization(request),
    // );
    await this.catalog.assertPackagesExist(
      packages.map((entry) => ({ packageId: entry.packageId, enabled: true })),
      readAuthorization(request),
    );
    return this.versionedItem({
      vendorId,
      vehicleTypes: this.normalizeVehicleTypes(body.vehicleTypes),
      washMethods: this.normalizeWashMethodIds(body.washMethodIds),
      serviceTypes: [],
      services,
      packages,
      existing: null,
    });
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

    const services = this.normalizeServices(body.services);
    const packages = this.normalizePackages(body.packages);
    await this.validateCatalog(request, services, packages);

    const ddbItem = this.versionedItem({
      vendorId,
      vehicleTypes: this.normalizeVehicleTypes(body.vehicleTypes),
      washMethods: this.normalizeWashMethodIds(body.washMethods),
      serviceTypes: this.normalizeCatalogIds(
        body.serviceTypes,
        isKnownServiceType,
        'service type',
      ),
      services,
      packages,
      existing,
    });

    await this.persist(ddbItem, existing?.updatedAt, vendorId, userId);
    return CapabilitiesMapper.toDomain(ddbItem);
  }

  private versionedItem(input: {
    vendorId: string;
    vehicleTypes: VehicleType[];
    washMethods?: string[];
    serviceTypes?: string[];
    services: VendorServiceOfferingRecord[];
    packages: VendorPackageOfferingRecord[];
    existing: VendorCapabilitiesDdbItem | null;
  }) {
    const priced = assignPricingConfiguration({
      hasExisting: Boolean(input.existing),
      configurationVersion: input.existing?.configurationVersion,
      existingServices: input.existing ? CapabilitiesMapper.servicesFromItem(input.existing) : [],
      existingPackages: input.existing ? CapabilitiesMapper.packagesFromItem(input.existing) : [],
      services: input.services,
      packages: input.packages,
    });
    return CapabilitiesMapper.toDdbItem({
      vendorId: input.vendorId,
      vehicleTypes: input.vehicleTypes,
      washMethods: input.washMethods,
      serviceTypes: input.serviceTypes,
      services: priced.services,
      packages: priced.packages,
      configurationVersion: priced.configurationVersion,
      createdAt: input.existing?.createdAt,
    });
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

  private normalizeWashMethodIds(values: string[]): string[] {
    const duplicate = findDuplicateId(values);
    if (duplicate) {
      throw new ValidationError(`Duplicate wash method: ${duplicate}`);
    }
    const resolved = values.map((value) => {
      const id = resolveWashMethodId(value);
      if (!id) {
        throw new ValidationError(`Unknown wash method: ${value}`);
      }
      return id;
    });
    if (new Set(resolved).size !== resolved.length) {
      throw new ValidationError('Duplicate wash method');
    }
    return resolved;
  }

  private normalizeVehicleTypes(values: VehicleType[]): VehicleType[] {
    const duplicate = findDuplicateId(values);
    if (duplicate) {
      throw new ValidationError(`Duplicate vehicle type: ${duplicate}`);
    }
    for (const value of values) {
      if (!isKnownVehicleType(value)) {
        throw new ValidationError(`Unknown vehicle type: ${value}`);
      }
    }
    return [...values];
  }

  private normalizeCatalogIds(
    values: string[],
    isKnown: (id: string) => boolean,
    label: string,
  ): string[] {
    const duplicate = findDuplicateId(values);
    if (duplicate) {
      throw new ValidationError(`Duplicate ${label}: ${duplicate}`);
    }
    for (const value of values) {
      if (!isKnown(value)) {
        throw new ValidationError(`Unknown ${label}: ${value}`);
      }
    }
    return [...values];
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
      throw new ValidationError(`Duplicate service mapping: ${duplicate}`);
    }

    return services.map((entry) => {
      const serviceId = entry.serviceId.trim();
      const categoryId = entry.categoryId.trim();
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
      throw new ValidationError(`Duplicate package mapping: ${duplicate}`);
    }

    return packages.map((entry) => {
      const packageId = entry.packageId.trim();
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
    // await this.catalog.assertServicesExist(
    //   servicesToCheck.map((entry) => ({
    //     serviceId: entry.serviceId,
    //     categoryId: entry.categoryId,
    //     enabled: entry.enabled,
    //   })),
    //   authorizationHeader,
    // );
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
