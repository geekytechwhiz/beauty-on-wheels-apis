/**
 * This file was automatically generated from the OpenAPI specification.
 * DO NOT EDIT DIRECTLY.
 */

export interface Category {
  id?: string;
  name?: string;
  description?: string;
  displayOrder?: number;
  active?: boolean;
  serviceCount?: number;
}

export type VehicleType = 'HATCHBACK' | 'SEDAN' | 'SUV' | 'MUV' | 'LUXURY' | 'BIKE';

export interface Service {
  id?: string;
  categoryId?: string;
  name?: string;
  description?: string;
  durationMinutes?: number;
  vehicleTypes?: VehicleType[];
  basePrice?: number;
  active?: boolean;
}

export interface Package {
  id?: string;
  name?: string;
  description?: string;
  services?: string[];
  discountedPrice?: number;
}

export interface AddOn {
  id?: string;
  name?: string;
  price?: number;
  durationMinutes?: number;
}

export interface PricingCalculateRequest {
  vehicleType: VehicleType;
  vendorId?: string;
  serviceIds?: string[];
  packageIds?: string[];
  addOnIds?: string[];
  addonIds?: string[];
  items?: Array<
    | { type: 'SERVICE'; serviceId: string; categoryId?: string }
    | { type: 'PACKAGE'; packageId: string }
  >;
  /** Ignored. Coupon support is Phase 2. */
  couponCode?: string;
}

