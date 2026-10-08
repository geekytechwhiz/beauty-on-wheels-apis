import { VEHICLE_TYPE_VALUES, type VehicleType } from '@api-hub/utils';

export const CAPABILITY_CATEGORY = {
  VEHICLE_TYPE: 'vehicleType',
} as const;

export type CapabilityCategory =
  (typeof CAPABILITY_CATEGORY)[keyof typeof CAPABILITY_CATEGORY];

export interface CapabilityDefinition {
  capabilityId: string;
  category: CapabilityCategory;
  code: VehicleType;
  name: string;
}

const VEHICLE_TYPE_NAMES: Record<VehicleType, string> = {
  HATCHBACK: 'Hatchback',
  SEDAN: 'Sedan',
  SUV: 'SUV',
  MUV: 'MUV',
  LUXURY: 'Luxury',
  BIKE: 'Bike',
};

const VEHICLE_TYPE_CAPABILITIES: CapabilityDefinition[] = VEHICLE_TYPE_VALUES.map(
  (code) => ({
    capabilityId: `vehicle:${code}`,
    category: CAPABILITY_CATEGORY.VEHICLE_TYPE,
    code,
    name: VEHICLE_TYPE_NAMES[code],
  }),
);

export const CAPABILITY_CATALOG_SOURCE = {
  services: 'service-catalog-service',
  packages: 'service-catalog-service',
} as const;

export function listAvailableCapabilities(): CapabilityDefinition[] {
  return VEHICLE_TYPE_CAPABILITIES.map((item) => ({ ...item }));
}

export function isKnownVehicleType(code: string): code is VehicleType {
  return VEHICLE_TYPE_CAPABILITIES.some((item) => item.code === code);
}
