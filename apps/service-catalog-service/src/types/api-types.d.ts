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
}

export interface Service {
  id?: string;
  categoryId?: string;
  name?: string;
  description?: string;
  durationMinutes?: number;
  vehicleTypes?: string[];
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

