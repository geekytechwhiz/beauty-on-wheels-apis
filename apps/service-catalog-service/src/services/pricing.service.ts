import {
  BaseError,
  LambdaRequest,
  isVehicleTypeSupported,
} from "@api-hub/utils";
import { createChildLogger, createLogger } from "@api-hub/observability";

import { assertVehicleType } from "../domain/catalog-validation";
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
  items: ReturnType<typeof calculatePriceBreakdown>["items"];
  pricingVersion: typeof PRICING_VERSION;
  calculatedAt: string;
  couponsApplied: false;
}

export class PricingService {
  constructor(
    private readonly servicesRepository: ServicesRepository = getServicesRepository(),
    private readonly packagesRepository: PackagesRepository = getPackagesRepository(),
    private readonly addOnsRepository: AddOnsRepository = getAddOnsRepository(),
    private readonly vendorPricing: VendorPricingProvider = getVendorPricingProvider(),
    private readonly now: () => Date = () => new Date(),
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

    const services = await this.loadServices(selection);
    const packages = await this.loadPackages(selection.packageIds);
    const addOns = await this.loadAddOns(selection.addOnIds);

    this.assertVehicleCompatibility(vehicleType, services, packages);

    const vendorPrices = selection.vendorId
      ? await this.vendorPricing.getPricing(
          selection.vendorId,
          request.context.authHeader,
        )
      : undefined;

    const lines = this.buildLines(services, packages, addOns, vendorPrices);
    const breakdown = calculatePriceBreakdown(lines);

    logger.info({
      event: "pricing_calculated",
      vehicleType,
      vendorId: selection.vendorId,
      serviceCount: services.length,
      packageCount: packages.length,
      addOnCount: addOns.length,
      totalPaise: Math.round(breakdown.total * 100),
      pricingVersion: breakdown.pricingVersion,
    });

    return {
      ...breakdown,
      vehicleType,
      ...(selection.vendorId ? { vendorId: selection.vendorId } : {}),
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
      services.push(service);
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
        services.push(service);
      }
      packages.push({ packageEntity, services });
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
      addOns.push(addon);
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

let service: PricingService | undefined;

export function getPricingService(): PricingService {
  if (!service) {
    service = new PricingService();
  }
  return service;
}
