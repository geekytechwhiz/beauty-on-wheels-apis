/**
 * This file was automatically generated from the OpenAPI specification.
 * DO NOT EDIT DIRECTLY.
 */

/**
 * Canonical vehicle-type list.
 * The HTTP body is the platform envelope. `data.items` is this array.
 * Do not read the response as a bare array.
 */
export interface VehicleTypeList {
  items: Array<'HATCHBACK' | 'SEDAN' | 'SUV' | 'MUV' | 'LUXURY' | 'BIKE'>;
}

export interface Vehicle {
  id?: string;
  userId?: string;
  registrationNumber: string;
  vehicleType: 'HATCHBACK' | 'SEDAN' | 'SUV' | 'MUV' | 'LUXURY' | 'BIKE';
  /** Canonical set lives in `@api-hub/utils` `VEHICLE_TYPE_VALUES`. */
  brand?: string;
  model?: string;
  variant?: string;
  color?: string;
  fuelType?: 'PETROL' | 'DIESEL' | 'EV' | 'HYBRID' | 'CNG';
  manufactureYear?: number;
  defaultVehicle?: boolean;
}

