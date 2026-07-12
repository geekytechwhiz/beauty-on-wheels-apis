/**
 * This file was automatically generated from the OpenAPI specification.
 * DO NOT EDIT DIRECTLY.
 */

export interface Vehicle {
  id?: string;
  userId?: string;
  registrationNumber: string;
  vehicleType: 'HATCHBACK' | 'SEDAN' | 'SUV' | 'MUV' | 'LUXURY' | 'BIKE';
  brand?: string;
  model?: string;
  variant?: string;
  color?: string;
  fuelType?: 'PETROL' | 'DIESEL' | 'EV' | 'HYBRID' | 'CNG';
  manufactureYear?: number;
  defaultVehicle?: boolean;
}

