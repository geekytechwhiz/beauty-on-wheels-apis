import { VehicleType } from '../types/api-types';
import {
  VendorCapabilitiesDdbItem,
  VendorPackageOfferingRecord,
  VendorServiceOfferingRecord,
} from '../types/repository.types';
import {
  VENDOR_CAPABILITIES_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

export class CapabilitiesMapper {
  static toDomain(item: VendorCapabilitiesDdbItem) {
    const services = CapabilitiesMapper.servicesFromItem(item);
    const packages = CapabilitiesMapper.packagesFromItem(item);
    return {
      vendorId: item.vendorId,
      vehicleTypes: item.vehicleTypes,
      serviceIds: services.filter((entry) => entry.enabled).map((entry) => entry.serviceId),
      packageIds: packages.filter((entry) => entry.enabled).map((entry) => entry.packageId),
      services: services.map(publicServiceOffering),
      packages: packages.map(publicPackageOffering),
      updatedAt: item.updatedAt,
    };
  }

  static empty(vendorId: string) {
    return {
      vendorId,
      vehicleTypes: [] as VehicleType[],
      serviceIds: [] as string[],
      packageIds: [] as string[],
      services: [] as VendorServiceOfferingRecord[],
      packages: [] as VendorPackageOfferingRecord[],
    };
  }

  static servicesFromItem(
    item: VendorCapabilitiesDdbItem,
  ): VendorServiceOfferingRecord[] {
    if (item.services) {
      return item.services.map((entry) => ({ ...entry }));
    }
    return (item.serviceIds ?? []).map((serviceId) => ({
      serviceId,
      enabled: true,
    }));
  }

  static packagesFromItem(
    item: VendorCapabilitiesDdbItem,
  ): VendorPackageOfferingRecord[] {
    if (item.packages) {
      return item.packages.map((entry) => ({ ...entry }));
    }
    return (item.packageIds ?? []).map((packageId) => ({
      packageId,
      enabled: true,
    }));
  }

  static toDdbItem(input: {
    vendorId: string;
    vehicleTypes: VehicleType[];
    services: VendorServiceOfferingRecord[];
    packages: VendorPackageOfferingRecord[];
    configurationVersion: number;
    createdAt?: string;
  }): VendorCapabilitiesDdbItem {
    const timestamp = new Date().toISOString();
    const services = input.services.map((entry) => stripUndefined(entry));
    const packages = input.packages.map((entry) => stripUndefined(entry));

    return {
      PK: VendorKeyBuilder.vendorPk(input.vendorId),
      SK: VendorKeyBuilder.capabilitiesSk(),
      vendorId: input.vendorId,
      vehicleTypes: [...new Set(input.vehicleTypes)],
      serviceIds: services
        .filter((entry) => entry.enabled)
        .map((entry) => entry.serviceId),
      packageIds: packages
        .filter((entry) => entry.enabled)
        .map((entry) => entry.packageId),
      services,
      packages,
      configurationVersion: input.configurationVersion,
      createdAt: input.createdAt || timestamp,
      updatedAt: timestamp,
      entityType: VENDOR_CAPABILITIES_ENTITY_TYPE,
    };
  }
}

function publicServiceOffering(entry: VendorServiceOfferingRecord) {
  return {
    serviceId: entry.serviceId,
    ...(entry.categoryId ? { categoryId: entry.categoryId } : {}),
    enabled: entry.enabled,
    ...(entry.priceOverride !== undefined ? { priceOverride: entry.priceOverride } : {}),
  };
}

function publicPackageOffering(entry: VendorPackageOfferingRecord) {
  return {
    packageId: entry.packageId,
    enabled: entry.enabled,
    ...(entry.priceOverride !== undefined ? { priceOverride: entry.priceOverride } : {}),
  };
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
