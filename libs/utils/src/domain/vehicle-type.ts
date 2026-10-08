/**
 * Canonical vehicle types for Beauty on Wheels.
 *
 * Source of truth is the customer vehicle model (vehicle-service):
 * HATCHBACK, SEDAN, SUV, MUV, LUXURY, BIKE.
 *
 * Vendor capabilities, catalog applicability, booking checks, and pricing
 * must use this list. Do not introduce BIKE / TWO_WHEELER / MOTORCYCLE / OTHER
 * as parallel names for the same concept.
 */
export const VEHICLE_TYPE = {
  HATCHBACK: 'HATCHBACK',
  SEDAN: 'SEDAN',
  SUV: 'SUV',
  MUV: 'MUV',
  LUXURY: 'LUXURY',
  BIKE: 'BIKE',
} as const;

export const VEHICLE_TYPE_VALUES = [
  VEHICLE_TYPE.HATCHBACK,
  VEHICLE_TYPE.SEDAN,
  VEHICLE_TYPE.SUV,
  VEHICLE_TYPE.MUV,
  VEHICLE_TYPE.LUXURY,
  VEHICLE_TYPE.BIKE,
] as const;

export type VehicleType = (typeof VEHICLE_TYPE_VALUES)[number];

const VEHICLE_TYPE_SET: ReadonlySet<string> = new Set(VEHICLE_TYPE_VALUES);

export function isVehicleType(value: string): value is VehicleType {
  return VEHICLE_TYPE_SET.has(value);
}

/**
 * A service supports a vehicle type only when that exact canonical value
 * is present on the service. Comparison is case-sensitive and does not
 * treat the first array element as special.
 */
export function isVehicleTypeSupported(
  service: { vehicleTypes?: readonly string[] | null },
  vehicleType: string,
): boolean {
  if (!isVehicleType(vehicleType)) {
    return false;
  }
  const supported = service.vehicleTypes ?? [];
  return supported.some((value) => value === vehicleType);
}
