import {
  VendorPackageOfferingRecord,
  VendorServiceOfferingRecord,
} from '../types/repository.types';

/** First persisted pricing version. Never taken from a caller. */
export const INITIAL_PRICING_VERSION = 1;

export interface AssignedPricingConfiguration {
  configurationVersion: number;
  services: VendorServiceOfferingRecord[];
  packages: VendorPackageOfferingRecord[];
}

/**
 * Server-owned versions for vendor pricing inputs.
 * A new configuration starts at 1. An existing configuration increments only
 * when an enabled flag or price override is added, removed, or changed.
 * Missing stored versions are initialized to 1 and are not themselves a change.
 */
export function assignPricingConfiguration(input: {
  hasExisting: boolean;
  configurationVersion?: number;
  existingServices: readonly VendorServiceOfferingRecord[];
  existingPackages: readonly VendorPackageOfferingRecord[];
  services: readonly VendorServiceOfferingRecord[];
  packages: readonly VendorPackageOfferingRecord[];
}): AssignedPricingConfiguration {
  if (!input.hasExisting) {
    return {
      configurationVersion: INITIAL_PRICING_VERSION,
      services: input.services.map((entry) => withVersion(entry, INITIAL_PRICING_VERSION)),
      packages: input.packages.map((entry) => withVersion(entry, INITIAL_PRICING_VERSION)),
    };
  }

  const services = assignServices(input.existingServices, input.services);
  const packages = assignPackages(input.existingPackages, input.packages);
  const changed = services.changed || packages.changed
    || membershipChanged(
      input.existingServices.map((entry) => entry.serviceId),
      input.services.map((entry) => entry.serviceId),
    )
    || membershipChanged(
      input.existingPackages.map((entry) => entry.packageId),
      input.packages.map((entry) => entry.packageId),
    );

  return {
    configurationVersion: changed
      ? bump(input.configurationVersion)
      : keep(input.configurationVersion),
    services: services.items,
    packages: packages.items,
  };
}

export function pricingInputsChanged(
  previous: { enabled: boolean; priceOverride?: number },
  next: { enabled: boolean; priceOverride?: number },
): boolean {
  return previous.enabled !== next.enabled || previous.priceOverride !== next.priceOverride;
}

function assignServices(
  existing: readonly VendorServiceOfferingRecord[],
  next: readonly VendorServiceOfferingRecord[],
): { items: VendorServiceOfferingRecord[]; changed: boolean } {
  const previousById = new Map(existing.map((entry) => [entry.serviceId, entry]));
  let changed = false;
  const items = next.map((entry) => {
    const previous = previousById.get(entry.serviceId);
    if (!previous) {
      changed = true;
      return withVersion(entry, INITIAL_PRICING_VERSION);
    }
    const contentChanged = pricingInputsChanged(previous, entry);
    changed = changed || contentChanged;
    return withVersion(entry, contentChanged ? bump(previous.version) : keep(previous.version));
  });
  return { items, changed };
}

function assignPackages(
  existing: readonly VendorPackageOfferingRecord[],
  next: readonly VendorPackageOfferingRecord[],
): { items: VendorPackageOfferingRecord[]; changed: boolean } {
  const previousById = new Map(existing.map((entry) => [entry.packageId, entry]));
  let changed = false;
  const items = next.map((entry) => {
    const previous = previousById.get(entry.packageId);
    if (!previous) {
      changed = true;
      return withVersion(entry, INITIAL_PRICING_VERSION);
    }
    const contentChanged = pricingInputsChanged(previous, entry);
    changed = changed || contentChanged;
    return withVersion(entry, contentChanged ? bump(previous.version) : keep(previous.version));
  });
  return { items, changed };
}

function withVersion<T extends { version?: number }>(entry: T, version: number): T {
  return { ...entry, version };
}

function keep(version: number | undefined): number {
  return isPricingVersion(version) ? version : INITIAL_PRICING_VERSION;
}

function bump(version: number | undefined): number {
  return keep(version) + 1;
}

function isPricingVersion(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function membershipChanged(previous: readonly string[], next: readonly string[]): boolean {
  if (previous.length !== next.length) {
    return true;
  }
  const nextIds = new Set(next);
  return previous.some((id) => !nextIds.has(id));
}
