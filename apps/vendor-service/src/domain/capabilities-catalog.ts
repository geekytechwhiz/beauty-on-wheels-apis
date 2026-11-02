import { VEHICLE_TYPE_VALUES, type VehicleType } from '@api-hub/utils';

/**
 * Canonical capability catalog.
 *
 * Every capability has a stable `capabilityId` (`<prefix>:<CODE>`) and a display label.
 * Vendors claim capabilities by id/code only; unknown ids are rejected by the
 * request schema and again by the service. Never guess ids on the client.
 */
export const CAPABILITY_CATEGORY = {
  VEHICLE_TYPE: 'vehicleType',
  WASH_METHOD: 'washMethod',
  SERVICE_TYPE: 'serviceType',
} as const;

export type CapabilityCategory =
  (typeof CAPABILITY_CATEGORY)[keyof typeof CAPABILITY_CATEGORY];

export interface CapabilityDefinition {
  capabilityId: string;
  category: CapabilityCategory;
  code: string;
  /** Display label. Kept as `name` for backward compatibility with existing clients. */
  name: string;
  label: string;
}

export interface CapabilityCategoryDefinition {
  category: CapabilityCategory;
  label: string;
  items: CapabilityDefinition[];
}

export const WASH_METHOD_VALUES = ['EXTERIOR', 'INTERIOR', 'FULL', 'FOAM'] as const;
export type WashMethod = (typeof WASH_METHOD_VALUES)[number];

export const SERVICE_TYPE_VALUES = ['CAR_WASH', 'DETAILING'] as const;
export type ServiceType = (typeof SERVICE_TYPE_VALUES)[number];

const VEHICLE_TYPE_NAMES: Record<VehicleType, string> = {
  HATCHBACK: 'Hatchback',
  SEDAN: 'Sedan',
  SUV: 'SUV',
  MUV: 'MUV',
  LUXURY: 'Luxury',
  BIKE: 'Bike',
};

const WASH_METHOD_NAMES: Record<WashMethod, string> = {
  EXTERIOR: 'Exterior wash',
  INTERIOR: 'Interior cleaning',
  FULL: 'Full wash',
  FOAM: 'Foam wash',
};

const SERVICE_TYPE_NAMES: Record<ServiceType, string> = {
  CAR_WASH: 'Car wash',
  DETAILING: 'Detailing',
};

const CATEGORY_LABELS: Record<CapabilityCategory, string> = {
  vehicleType: 'Vehicle types',
  washMethod: 'Wash methods',
  serviceType: 'Service types',
};

const CATEGORY_PREFIX: Record<CapabilityCategory, string> = {
  vehicleType: 'vehicle',
  washMethod: 'wash',
  serviceType: 'service',
};

function definition(
  category: CapabilityCategory,
  code: string,
  name: string,
): CapabilityDefinition {
  return {
    capabilityId: `${CATEGORY_PREFIX[category]}:${code}`,
    category,
    code,
    name,
    label: name,
  };
}

const VEHICLE_TYPE_CAPABILITIES: CapabilityDefinition[] = VEHICLE_TYPE_VALUES.map(
  (code) => definition(CAPABILITY_CATEGORY.VEHICLE_TYPE, code, VEHICLE_TYPE_NAMES[code]),
);

const WASH_METHOD_CAPABILITIES: CapabilityDefinition[] = WASH_METHOD_VALUES.map(
  (code) => definition(CAPABILITY_CATEGORY.WASH_METHOD, code, WASH_METHOD_NAMES[code]),
);

const SERVICE_TYPE_CAPABILITIES: CapabilityDefinition[] = SERVICE_TYPE_VALUES.map(
  (code) => definition(CAPABILITY_CATEGORY.SERVICE_TYPE, code, SERVICE_TYPE_NAMES[code]),
);

const CATALOG_BY_CATEGORY: Record<CapabilityCategory, CapabilityDefinition[]> = {
  vehicleType: VEHICLE_TYPE_CAPABILITIES,
  washMethod: WASH_METHOD_CAPABILITIES,
  serviceType: SERVICE_TYPE_CAPABILITIES,
};

export const WASH_METHOD_CAPABILITY_IDS = WASH_METHOD_CAPABILITIES.map(
  (item) => item.capabilityId,
) as [string, ...string[]];

export const SERVICE_TYPE_CAPABILITY_IDS = SERVICE_TYPE_CAPABILITIES.map(
  (item) => item.capabilityId,
) as [string, ...string[]];

export const CAPABILITY_CATALOG_SOURCE = {
  services: 'service-catalog-service',
  packages: 'service-catalog-service',
} as const;

function clone(items: CapabilityDefinition[]): CapabilityDefinition[] {
  return items.map((item) => ({ ...item }));
}

/** Flat list of every catalog entry across all categories. */
export function listCapabilityDefinitions(): CapabilityDefinition[] {
  return [
    ...clone(VEHICLE_TYPE_CAPABILITIES),
    ...clone(WASH_METHOD_CAPABILITIES),
    ...clone(SERVICE_TYPE_CAPABILITIES),
  ];
}

export function listCapabilityCategories(): CapabilityCategoryDefinition[] {
  return (Object.keys(CATALOG_BY_CATEGORY) as CapabilityCategory[]).map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    items: clone(CATALOG_BY_CATEGORY[category]),
  }));
}

/** Vehicle types only. Retained for existing callers. */
export function listAvailableCapabilities(): CapabilityDefinition[] {
  return clone(VEHICLE_TYPE_CAPABILITIES);
}

export function listCapabilitiesByCategory(
  category: CapabilityCategory,
): CapabilityDefinition[] {
  return clone(CATALOG_BY_CATEGORY[category]);
}

export function isKnownVehicleType(code: string): code is VehicleType {
  return VEHICLE_TYPE_CAPABILITIES.some((item) => item.code === code);
}

export function isKnownWashMethod(capabilityId: string): boolean {
  return WASH_METHOD_CAPABILITIES.some((item) => item.capabilityId === capabilityId);
}

/**
 * Accepts a catalog capability id (`wash:EXTERIOR`) or the stable code (`EXTERIOR`).
 * Display labels are rejected. The persisted value is always the capability id.
 */
export function resolveWashMethodId(value: string): string | undefined {
  const trimmed = value.trim();
  const byId = WASH_METHOD_CAPABILITIES.find((item) => item.capabilityId === trimmed);
  if (byId) return byId.capabilityId;
  const byCode = WASH_METHOD_CAPABILITIES.find((item) => item.code === trimmed);
  return byCode?.capabilityId;
}

export function isKnownServiceType(capabilityId: string): boolean {
  return SERVICE_TYPE_CAPABILITIES.some((item) => item.capabilityId === capabilityId);
}

/** True for any catalog id in the wash-method or service-type categories (proposal service scope). */
export function isKnownServiceScopeCode(value: string): boolean {
  return isKnownWashMethod(value) || isKnownServiceType(value);
}

export function findCapability(capabilityId: string): CapabilityDefinition | undefined {
  const found = listCapabilityDefinitions().find(
    (item) => item.capabilityId === capabilityId,
  );
  return found;
}
