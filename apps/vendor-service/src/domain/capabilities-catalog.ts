import { VehicleType } from '../types/api-types';

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

const VEHICLE_TYPE_CAPABILITIES: CapabilityDefinition[] = [
  {
    capabilityId: 'vehicle:HATCHBACK',
    category: CAPABILITY_CATEGORY.VEHICLE_TYPE,
    code: 'HATCHBACK',
    name: 'Hatchback',
  },
  {
    capabilityId: 'vehicle:SEDAN',
    category: CAPABILITY_CATEGORY.VEHICLE_TYPE,
    code: 'SEDAN',
    name: 'Sedan',
  },
  {
    capabilityId: 'vehicle:SUV',
    category: CAPABILITY_CATEGORY.VEHICLE_TYPE,
    code: 'SUV',
    name: 'SUV',
  },
  {
    capabilityId: 'vehicle:MUV',
    category: CAPABILITY_CATEGORY.VEHICLE_TYPE,
    code: 'MUV',
    name: 'MUV',
  },
  {
    capabilityId: 'vehicle:LUXURY',
    category: CAPABILITY_CATEGORY.VEHICLE_TYPE,
    code: 'LUXURY',
    name: 'Luxury',
  },
  {
    capabilityId: 'vehicle:OTHER',
    category: CAPABILITY_CATEGORY.VEHICLE_TYPE,
    code: 'OTHER',
    name: 'Other',
  },
];

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
