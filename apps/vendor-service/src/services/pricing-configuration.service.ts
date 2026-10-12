import { BaseError, ConditionalWriteConflictError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { INITIAL_PRICING_VERSION } from '../domain/pricing-configuration';
import { CapabilitiesMapper } from '../mappers/capabilities.mapper';
import {
  CapabilitiesRepository,
  getCapabilitiesRepository,
} from '../repositories/capabilities.repository';
import { getVendorsRepository, VendorsRepository } from '../repositories/vendors.repository';
import {
  VendorCapabilitiesDdbItem,
  VendorPackageOfferingRecord,
  VendorServiceOfferingRecord,
} from '../types/repository.types';

const logger = createChildLogger(
  createLogger({ service: 'vendor-service', redactPII: true }),
  { service: 'PricingConfigurationService' },
);

const MAX_BACKFILL_ATTEMPTS = 3;

export interface PricingConfigurationOffering {
  serviceId?: string;
  packageId?: string;
  enabled: boolean;
  priceOverride?: number;
  version: number;
}

export interface PricingConfiguration {
  vendorId: string;
  configurationVersion: number;
  services: Array<{
    serviceId: string;
    enabled: boolean;
    priceOverride?: number;
    version: number;
  }>;
  packages: Array<{
    packageId: string;
    enabled: boolean;
    priceOverride?: number;
    version: number;
  }>;
}

export class PricingConfigurationService {
  constructor(
    private readonly vendors: VendorsRepository = getVendorsRepository(),
    private readonly capabilities: CapabilitiesRepository = getCapabilitiesRepository(),
  ) {}

  async get(vendorId: string): Promise<PricingConfiguration> {
    const vendor = await this.vendors.getVendorById(vendorId);
    if (!vendor) {
      throw new BaseError(`Vendor not found: ${vendorId}`, 404, 'VENDOR_NOT_FOUND');
    }

    for (let attempt = 1; attempt <= MAX_BACKFILL_ATTEMPTS; attempt += 1) {
      const item = await this.capabilities.getCapabilities(vendorId);
      if (!item) {
        return emptyConfiguration(vendorId);
      }
      const projection = project(item);
      if (!projection.needsBackfill) {
        logger.info({
          event: 'pricing_configuration_read',
          vendorId,
          configurationVersion: projection.configuration.configurationVersion,
        });
        return projection.configuration;
      }
      try {
        await this.capabilities.putCapabilities(projection.backfill, item.updatedAt);
        return projection.configuration;
      } catch (error) {
        if (error instanceof ConditionalWriteConflictError && attempt < MAX_BACKFILL_ATTEMPTS) {
          continue;
        }
        if (error instanceof ConditionalWriteConflictError) {
          throw new BaseError(
            'Vendor pricing configuration changed concurrently',
            409,
            'PRICING_CONFIGURATION_CONFLICT',
          );
        }
        throw error;
      }
    }
    throw new BaseError(
      'Vendor pricing configuration changed concurrently',
      409,
      'PRICING_CONFIGURATION_CONFLICT',
    );
  }
}

function emptyConfiguration(vendorId: string): PricingConfiguration {
  return {
    vendorId,
    configurationVersion: INITIAL_PRICING_VERSION,
    services: [],
    packages: [],
  };
}

function project(item: VendorCapabilitiesDdbItem): {
  configuration: PricingConfiguration;
  backfill: VendorCapabilitiesDdbItem;
  needsBackfill: boolean;
} {
  const services = CapabilitiesMapper.servicesFromItem(item).map(requireService);
  const packages = CapabilitiesMapper.packagesFromItem(item).map(requirePackage);
  const configurationVersion = requireConfigurationVersion(item.configurationVersion);
  const needsBackfill = item.configurationVersion === undefined
    || services.some((entry) => entry.initialized)
    || packages.some((entry) => entry.initialized);
  const configuration = {
    vendorId: item.vendorId,
    configurationVersion,
    services: services.map((entry) => entry.offering),
    packages: packages.map((entry) => entry.offering),
  };
  return {
    configuration,
    needsBackfill,
    backfill: {
      ...item,
      services: configuration.services,
      packages: configuration.packages,
      serviceIds: configuration.services.filter((entry) => entry.enabled).map((entry) => entry.serviceId),
      packageIds: configuration.packages.filter((entry) => entry.enabled).map((entry) => entry.packageId),
      configurationVersion,
    },
  };
}

function requireConfigurationVersion(value: number | undefined): number {
  if (value === undefined) {
    return INITIAL_PRICING_VERSION;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new BaseError(
      'Stored vendor pricing configuration version is invalid',
      502,
      'PRICING_CONFIGURATION_INVALID',
    );
  }
  return value;
}

function requireService(entry: VendorServiceOfferingRecord): {
  offering: PricingConfiguration['services'][number];
  initialized: boolean;
} {
  const version = requireOfferingVersion(entry.version, entry.serviceId);
  return {
    initialized: entry.version === undefined,
    offering: {
      serviceId: entry.serviceId,
      enabled: entry.enabled,
      ...(entry.priceOverride !== undefined ? { priceOverride: entry.priceOverride } : {}),
      version,
    },
  };
}

function requirePackage(entry: VendorPackageOfferingRecord): {
  offering: PricingConfiguration['packages'][number];
  initialized: boolean;
} {
  const version = requireOfferingVersion(entry.version, entry.packageId);
  return {
    initialized: entry.version === undefined,
    offering: {
      packageId: entry.packageId,
      enabled: entry.enabled,
      ...(entry.priceOverride !== undefined ? { priceOverride: entry.priceOverride } : {}),
      version,
    },
  };
}

function requireOfferingVersion(value: number | undefined, id: string): number {
  if (value === undefined) {
    return INITIAL_PRICING_VERSION;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new BaseError(
      `Stored vendor pricing version for ${id} is invalid`,
      502,
      'PRICING_CONFIGURATION_INVALID',
    );
  }
  return value;
}

let service: PricingConfigurationService | undefined;

export function getPricingConfigurationService(): PricingConfigurationService {
  if (!service) {
    service = new PricingConfigurationService();
  }
  return service;
}
