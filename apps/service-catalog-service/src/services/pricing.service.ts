import {
  BaseError,
  ConditionalWriteConflictError,
  LambdaRequest,
  isVehicleTypeSupported,
} from "@api-hub/utils";
import { createChildLogger, createLogger } from "@api-hub/observability";

import { assertVehicleType } from "../domain/catalog-validation";
import { isAuthoritativeCatalogVersion } from "../domain/catalog-version";
import {
  MAX_OFFERING_REVISION_ATTEMPTS,
  NO_VENDOR_PRICING_VERSION,
  OfferingRevisionInput,
  OfferingRevisionStore,
  nextOfferingVersion,
  revisionsMatch,
} from "../domain/offering-revision";
import {
  PRICING_CURRENCY,
  PRICING_VERSION,
  calculatePriceBreakdown,
  type PricingLineInput,
} from "../domain/pricing";
import {
  VendorPricingProvider,
  VendorPricingSnapshot,
  getVendorPricingProvider,
} from "../integrations/vendor-pricing-provider";
import {
  AddOnsRepository,
  getAddOnsRepository,
} from "../repositories/add-ons.repository";
import {
  PackagesRepository,
  getPackagesRepository,
} from "../repositories/packages.repository";
import {
  ServicesRepository,
  getServicesRepository,
} from "../repositories/services.repository";
import {
  ResolvedPricingSelection,
  validatePricingCalculate,
} from "../schemas/pricing.schema";
import {
  getOfferingRevisionsRepository,
  getPackageOfferingRevisionsRepository,
} from "../repositories/offering-revisions.repository";
import { AddonEntity, PackageEntity, ServiceEntity } from "../utils/types/catalog-domain.types";

const logger = createChildLogger(
  createLogger({ service: "service-catalog-service", redactPII: true }),
  { service: "PricingService" },
);

export interface PricingResult {
  currency: typeof PRICING_CURRENCY;
  vehicleType: string;
  vendorId?: string;
  subtotal: number;
  discount: number;
  addOnTotal: number;
  total: number;
  items: Array<ReturnType<typeof calculatePriceBreakdown>["items"][number] & {
    catalogVersion?: number;
    vendorPricingVersion?: number;
    offeringVersion?: number;
  }>;
  pricingVersion: typeof PRICING_VERSION;
  calculatedAt: string;
  couponsApplied: false;
  /**
   * Effective offering revision for a single vendor-scoped service or package.
   * Booking submits this integer as offeringVersion.
   */
  offeringVersion?: number;
  /** Alias of offeringVersion for clients that read `version`. */
  version?: number;
  catalogVersion?: number;
  vendorPricingVersion?: number;
  vendorConfigurationVersion?: number;
}

export class PricingService {
  constructor(
    private readonly servicesRepository: ServicesRepository = getServicesRepository(),
    private readonly packagesRepository: PackagesRepository = getPackagesRepository(),
    private readonly addOnsRepository: AddOnsRepository = getAddOnsRepository(),
    private readonly vendorPricing: VendorPricingProvider = getVendorPricingProvider(),
    private readonly now: () => Date = () => new Date(),
    private readonly serviceRevisions: OfferingRevisionStore = getOfferingRevisionsRepository(),
    private readonly packageRevisions: OfferingRevisionStore = getPackageOfferingRevisionsRepository(),
  ) {}

  async calculate(request: LambdaRequest): Promise<PricingResult> {
    const selection = validatePricingCalculate(request);
    const vehicleType = assertVehicleType(selection.vehicleType);
    this.assertSelection(selection);

    if (selection.couponCodeIgnored) {
      logger.info({
        event: "pricing_coupon_ignored",
        reason: "coupon support is phase 2",
      });
    }

    for (let attempt = 1; attempt <= MAX_OFFERING_REVISION_ATTEMPTS; attempt += 1) {
      const priced = await this.priceSelection(selection, vehicleType);
      try {
        const offeringVersion = await this.resolveRevision(priced.revision);
        const result = this.toResult(priced, selection, vehicleType, offeringVersion);
        logger.info({
          event: "pricing_calculated",
          vehicleType,
          vendorId: selection.vendorId,
          serviceCount: priced.services.length,
          packageCount: priced.packages.length,
          addOnCount: priced.addOns.length,
          totalPaise: Math.round(result.total * 100),
          pricingVersion: result.pricingVersion,
          offeringVersion: result.offeringVersion,
          catalogVersion: result.catalogVersion,
          vendorPricingVersion: result.vendorPricingVersion,
        });
        return result;
      } catch (error) {
        if (error instanceof ConditionalWriteConflictError && attempt < MAX_OFFERING_REVISION_ATTEMPTS) {
          logger.warn({ event: "offering_revision_retry", attempt, vendorId: selection.vendorId });
          continue;
        }
        if (error instanceof ConditionalWriteConflictError) {
          throw new BaseError(
            "Pricing inputs changed concurrently",
            409,
            "OFFERING_REVISION_CONFLICT",
          );
        }
        throw error;
      }
    }

    throw new BaseError(
      "Pricing inputs changed concurrently",
      409,
      "OFFERING_REVISION_CONFLICT",
    );
  }

  private async priceSelection(
    selection: ResolvedPricingSelection,
    vehicleType: string,
  ): Promise<PricedSelection> {
    const services = await this.loadServices(selection);
    const packages = await this.loadPackages(selection.packageIds);
    const addOns = await this.loadAddOns(selection.addOnIds);
    this.assertVehicleCompatibility(vehicleType, services, packages);
    const vendorPrices = selection.vendorId
      ? await this.vendorPricing.getPricing(selection.vendorId)
      : undefined;
    if (vendorPrices && !isAuthoritativeCatalogVersion(vendorPrices.configurationVersion)) {
      throw new BaseError(
        "Vendor pricing configuration has no authoritative version",
        502,
        "VENDOR_PRICING_UNAVAILABLE",
      );
    }
    const lines = this.buildLines(services, packages, addOns, vendorPrices);
    return {
      services,
      packages,
      addOns,
      vendorPrices,
      breakdown: calculatePriceBreakdown(lines),
      revision: this.revisionInput(selection.vendorId, services, packages, addOns, vendorPrices),
    };
  }

  private revisionInput(
    vendorId: string | undefined,
    services: readonly ServiceEntity[],
    packages: ReadonlyArray<{ packageEntity: PackageEntity; services: ServiceEntity[] }>,
    addOns: readonly AddonEntity[],
    vendorPrices: VendorPricingSnapshot | undefined,
  ): (OfferingRevisionInput & { kind: "SERVICE" | "PACKAGE" }) | undefined {
    if (!vendorId || services.length + packages.length !== 1) {
      return undefined;
    }
    if (services.length === 1) {
      const service = services[0];
      return {
        kind: "SERVICE",
        offeringId: service.serviceId,
        vendorId,
        catalogVersion: requireCatalogVersion(service.version, service.serviceId),
        vendorPricingVersion: vendorOfferingVersion(vendorPrices?.services.get(service.serviceId)),
        dependencyVersions: addOns.map((addon) => ({
          id: addon.addonId,
          version: requireCatalogVersion(addon.version, addon.addonId),
        })),
      };
    }
    const entry = packages[0];
    return {
      kind: "PACKAGE",
      offeringId: entry.packageEntity.packageId,
      vendorId,
      catalogVersion: requireCatalogVersion(entry.packageEntity.version, entry.packageEntity.packageId),
      vendorPricingVersion: vendorOfferingVersion(
        vendorPrices?.packages.get(entry.packageEntity.packageId),
      ),
      dependencyVersions: [
        ...entry.services.map((service) => ({
          id: service.serviceId,
          version: requireCatalogVersion(service.version, service.serviceId),
        })),
        ...addOns.map((addon) => ({
          id: addon.addonId,
          version: requireCatalogVersion(addon.version, addon.addonId),
        })),
      ],
    };
  }

  private async resolveRevision(
    revision: (OfferingRevisionInput & { kind: "SERVICE" | "PACKAGE" }) | undefined,
  ): Promise<number | undefined> {
    if (!revision) {
      return undefined;
    }
    const store = revision.kind === "PACKAGE" ? this.packageRevisions : this.serviceRevisions;
    const current = await store.findRevision(revision.offeringId, revision.vendorId);
    if (current && revisionsMatch(current, revision)) {
      return current.offeringVersion;
    }
    let offeringVersion: number;
    try {
      offeringVersion = nextOfferingVersion(current);
    } catch {
      throw new BaseError(
        "Stored offering revision is invalid",
        502,
        "CATALOG_PRICING_UNAVAILABLE",
      );
    }
    await store.putRevision({
      offeringId: revision.offeringId,
      vendorId: revision.vendorId,
      catalogVersion: revision.catalogVersion,
      vendorPricingVersion: revision.vendorPricingVersion,
      dependencyVersions: revision.dependencyVersions,
      offeringVersion,
    }, current ? current.offeringVersion : undefined);
    return offeringVersion;
  }

  private toResult(
    priced: PricedSelection,
    selection: ResolvedPricingSelection,
    vehicleType: string,
    offeringVersion: number | undefined,
  ): PricingResult {
    const primaryId = priced.revision?.offeringId;
    return {
      ...priced.breakdown,
      items: priced.breakdown.items.map((item) => ({
        ...item,
        ...(item.id === primaryId && priced.revision
          ? {
            catalogVersion: priced.revision.catalogVersion,
            vendorPricingVersion: priced.revision.vendorPricingVersion,
            ...(offeringVersion === undefined ? {} : { offeringVersion }),
          }
          : {}),
      })),
      vehicleType,
      ...(selection.vendorId ? { vendorId: selection.vendorId } : {}),
      ...(priced.vendorPrices
        ? { vendorConfigurationVersion: priced.vendorPrices.configurationVersion }
        : {}),
      ...(offeringVersion === undefined
        ? {}
        : {
          offeringVersion,
          version: offeringVersion,
          catalogVersion: priced.revision?.catalogVersion,
          vendorPricingVersion: priced.revision?.vendorPricingVersion,
        }),
      calculatedAt: this.now().toISOString(),
      couponsApplied: false,
    };
  }

  private assertSelection(selection: ResolvedPricingSelection): void {
    if (selection.services.length === 0 && selection.packageIds.length === 0) {
      throw new BaseError(
        "At least one service or package is required",
        400,
        "VALIDATION_ERROR",
      );
    }
    const serviceIds = selection.services.map((item) => item.serviceId);
    if (new Set(serviceIds).size !== serviceIds.length) {
      throw new BaseError("Duplicate service selection", 400, "VALIDATION_ERROR");
    }
    if (new Set(selection.packageIds).size !== selection.packageIds.length) {
      throw new BaseError("Duplicate package selection", 400, "VALIDATION_ERROR");
    }
    if (new Set(selection.addOnIds).size !== selection.addOnIds.length) {
      throw new BaseError("Duplicate add-on selection", 400, "VALIDATION_ERROR");
    }
  }

  private async loadServices(
    selection: ResolvedPricingSelection,
  ): Promise<ServiceEntity[]> {
    const services: ServiceEntity[] = [];
    for (const item of selection.services) {
      const service = item.categoryId
        ? await this.servicesRepository.findById(item.categoryId, item.serviceId)
        : await this.servicesRepository.findByServiceId(item.serviceId);
      if (!service || service.entityType !== "SERVICE") {
        throw new BaseError(
          `Service not found: ${item.serviceId}`,
          404,
          "SERVICE_NOT_FOUND",
        );
      }
      if (!service.active) {
        throw new BaseError(
          `Service is not active: ${item.serviceId}`,
          409,
          "CATALOG_ENTITY_INACTIVE",
        );
      }
      services.push(await this.servicesRepository.ensureServiceVersion(service));
    }
    return services;
  }

  private async loadPackages(packageIds: readonly string[]): Promise<Array<{
    packageEntity: PackageEntity;
    services: ServiceEntity[];
  }>> {
    const packages: Array<{
      packageEntity: PackageEntity;
      services: ServiceEntity[];
    }> = [];
    for (const packageId of packageIds) {
      const packageEntity = await this.packagesRepository.findById(packageId);
      if (!packageEntity) {
        throw new BaseError(
          `Package not found: ${packageId}`,
          404,
          "PACKAGE_NOT_FOUND",
        );
      }
      if (!packageEntity.active) {
        throw new BaseError(
          `Package is not active: ${packageId}`,
          409,
          "CATALOG_ENTITY_INACTIVE",
        );
      }
      const itemRefs = await this.packagesRepository.listPackageServiceItems(packageId);
      if (itemRefs.length === 0) {
        throw new BaseError(
          `Package has no services: ${packageId}`,
          400,
          "INVALID_PACKAGE",
        );
      }
      const services: ServiceEntity[] = [];
      for (const item of itemRefs) {
        const service = await this.servicesRepository.findByServiceId(item.refId);
        if (!service || !service.active) {
          throw new BaseError(
            `Package references an unavailable service: ${item.refId}`,
            400,
            "INVALID_PACKAGE",
          );
        }
        services.push(await this.servicesRepository.ensureServiceVersion(service));
      }
      packages.push({
        packageEntity: await this.packagesRepository.ensurePackageVersion(packageEntity),
        services,
      });
    }
    return packages;
  }

  private async loadAddOns(addOnIds: readonly string[]): Promise<AddonEntity[]> {
    const addOns: AddonEntity[] = [];
    for (const addonId of addOnIds) {
      const addon = await this.addOnsRepository.findByAddonId(addonId);
      if (!addon) {
        throw new BaseError(
          `Add-on not found: ${addonId}`,
          404,
          "ADDON_NOT_FOUND",
        );
      }
      if (!addon.active) {
        throw new BaseError(
          `Add-on is not active: ${addonId}`,
          409,
          "CATALOG_ENTITY_INACTIVE",
        );
      }
      addOns.push(await this.addOnsRepository.ensureAddonVersion(addon));
    }
    return addOns;
  }

  private assertVehicleCompatibility(
    vehicleType: string,
    services: readonly ServiceEntity[],
    packages: ReadonlyArray<{ packageEntity: PackageEntity; services: ServiceEntity[] }>,
  ): void {
    const candidates = [
      ...services,
      ...packages.flatMap((entry) => entry.services),
    ];
    for (const service of candidates) {
      if (!isVehicleTypeSupported(service, vehicleType)) {
        throw new BaseError(
          `Vehicle type ${vehicleType} is not supported by service ${service.serviceId}`,
          400,
          "VEHICLE_TYPE_NOT_SUPPORTED",
        );
      }
    }
  }

  private buildLines(
    services: readonly ServiceEntity[],
    packages: ReadonlyArray<{ packageEntity: PackageEntity; services: ServiceEntity[] }>,
    addOns: readonly AddonEntity[],
    vendorPrices: VendorPricingSnapshot | undefined,
  ): PricingLineInput[] {
    const lines: PricingLineInput[] = [];

    for (const service of services) {
      const offering = vendorPrices?.services.get(service.serviceId);
      if (offering && !offering.enabled) {
        throw new BaseError(
          `Vendor does not offer service ${service.serviceId}`,
          409,
          "VENDOR_SERVICE_DISABLED",
        );
      }
      lines.push({
        type: "SERVICE",
        id: service.serviceId,
        name: service.name,
        catalogPrice: service.basePrice,
        ...(offering?.priceOverride === undefined
          ? {}
          : { providerPrice: offering.priceOverride }),
      });
    }

    for (const entry of packages) {
      const offering = vendorPrices?.packages.get(entry.packageEntity.packageId);
      if (offering && !offering.enabled) {
        throw new BaseError(
          `Vendor does not offer package ${entry.packageEntity.packageId}`,
          409,
          "VENDOR_SERVICE_DISABLED",
        );
      }
      lines.push({
        type: "PACKAGE",
        id: entry.packageEntity.packageId,
        name: entry.packageEntity.name,
        catalogPrice: entry.packageEntity.discountedPrice,
        ...(offering?.priceOverride === undefined
          ? {}
          : { providerPrice: offering.priceOverride }),
      });
    }

    for (const addon of addOns) {
      lines.push({
        type: "ADD_ON",
        id: addon.addonId,
        name: addon.name,
        catalogPrice: addon.price,
      });
    }

    return lines;
  }
}

interface PricedSelection {
  services: ServiceEntity[];
  packages: Array<{ packageEntity: PackageEntity; services: ServiceEntity[] }>;
  addOns: AddonEntity[];
  vendorPrices?: VendorPricingSnapshot;
  breakdown: ReturnType<typeof calculatePriceBreakdown>;
  revision?: OfferingRevisionInput & { kind: "SERVICE" | "PACKAGE" };
}

function requireCatalogVersion(version: number | undefined, id: string): number {
  if (!isAuthoritativeCatalogVersion(version)) {
    throw new BaseError(
      `Catalog entity ${id} has no authoritative version`,
      502,
      "CATALOG_PRICING_UNAVAILABLE",
    );
  }
  return version;
}

function vendorOfferingVersion(offering: { version: number } | undefined): number {
  if (!offering) {
    return NO_VENDOR_PRICING_VERSION;
  }
  if (!Number.isInteger(offering.version) || offering.version < 1) {
    throw new BaseError(
      "Vendor pricing offering has no authoritative version",
      502,
      "VENDOR_PRICING_UNAVAILABLE",
    );
  }
  return offering.version;
}

let service: PricingService | undefined;

export function getPricingService(): PricingService {
  if (!service) {
    service = new PricingService();
  }
  return service;
}
