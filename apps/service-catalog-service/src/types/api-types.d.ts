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

export type VehicleType =
  | 'HATCHBACK'
  | 'SEDAN'
  | 'SUV'
  | 'MUV'
  | 'LUXURY'
  | 'BIKE';

export interface Service {
  id?: string;
  categoryId?: string;
  name?: string;
  description?: string;
  durationMinutes?: number;
  vehicleTypes?: VehicleType[];
  basePrice?: number;
  active?: boolean;
  /** Catalog input version. Booking uses the pricing offeringVersion. */
  version?: number;
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

type DiscoverySortBy =
  | 'RELEVANCE'
  | 'DISTANCE_ASC'
  | 'PRICE_ASC'
  | 'PRICE_DESC'
  | 'RATING_DESC';

interface DiscoverServicesQuery {
  search?: string;
  categoryId?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  vehicleType?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  sortBy?: DiscoverySortBy;
  limit?: number;
  nextToken?: string;
}

interface DiscoveryPage {
  items: DiscoveryService[];
  nextToken?: string;
  hasMore: boolean;
}

interface DiscoveryService {
  serviceId: string;
  vendorId: string;
  branchId?: string;
  categoryId: string;
  name: string;
  description?: string;
  vehicleTypes: string[];
  durationMinutes: number;
  displayPrice: number;
  currency: string;
  distanceKm?: number;
  rating?: number;
  reviewCount?: number;
   


}