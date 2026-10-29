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

export interface VehiclePricing {
  vehicleType: VehicleType;
  /** Integer minor units for managed offerings; major units on legacy discovery rows. Final customer price. */
  price: number;
  /**
   * Total package duration across visits in the billing period for this vehicle.
   * Per-visit duration is on IncludedService.durationMinutes.
   */
  durationMinutes: number;
}

export interface IncludedService {
  name: string;
  description?: string;
  categoryId: string;
  tags?: string[];
  /** Stable entitlement identity; unique within the offering when set. */
  serviceKey?: string;
  visitsPerPeriod: number;
  /** Duration of one visit of this included service. */
  durationMinutes: number;
}

/** Computed from includedServices for booking and plan clients. */
export interface OfferingEntitlement {
  serviceId: string;
  quantity: number;
  name: string;
  durationMinutes: number;
  categoryId: string;
}

/** Package-defined preferred visit window (not a confirmed availability slot). */
export interface OfferingVisitWindow {
  visitWindowId: string;
  label: string;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
}

export type OfferingType = 'PACKAGE' | 'SERVICE';

export type OfferingStatus = 'draft' | 'published' | 'paused' | 'archived';

export type BillingPeriod = 'oneTime' | 'weekly' | 'monthly' | 'yearly';

export interface CreateOfferingRequest {
  vendorId: string;
  categoryId: string;
  offeringType: 'PACKAGE';
  name: string;
  description?: string;
  billingPeriod: BillingPeriod;
  currency?: string;
  /** Purchase validity window in days for oneTime packages; optional metadata otherwise. */
  validityDays?: number;
  vehiclePricing: VehiclePricing[];
  includedServices: IncludedService[];
  visitWindows?: OfferingVisitWindow[];
  status?: 'draft' | 'published';
  displayOrder?: number;
  communityIds?: string[];
}

export interface PatchOfferingRequest {
  name?: string;
  description?: string;
  billingPeriod?: BillingPeriod;
  currency?: string;
  validityDays?: number;
  vehiclePricing?: VehiclePricing[];
  includedServices?: IncludedService[];
  visitWindows?: OfferingVisitWindow[];
  status?: OfferingStatus;
  displayOrder?: number;
  expectedVersion?: number;
}

export interface Offering {
  offeringId: string;
  offeringType: OfferingType;
  vendorId: string;
  categoryId: string;
  name: string;
  description?: string;
  billingPeriod: BillingPeriod;
  currency: string;
  validityDays?: number;
  vehiclePricing: VehiclePricing[];
  vehicleTypes: VehicleType[];
  includedServices: IncludedService[];
  entitlements: OfferingEntitlement[];
  visitWindows?: OfferingVisitWindow[];
  status: OfferingStatus;
  active: boolean;
  version: number;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  legacySource?: 'SERVICE' | 'PACKAGE';
}

export interface OfferingPage {
  items: Offering[];
  nextToken?: string;
  total: number;
}

/** Customer marketplace discovery projection (GET /offerings). */
export interface MarketplaceOffering {
  offeringId: string;
  serviceId: string;
  name: string;
  description?: string;
  categoryId: string;
  vendorId: string;
  /** Optional — community package discovery may omit branch coverage. */
  branchId?: string;
  vehicleTypes: VehicleType[] | string[];
  displayPrice: number;
  currency: string;
  durationMinutes: number;
  distanceKm?: number;
  rating?: number;
  reviewCount?: number;
  status: 'active';
  imageUrl: {
    alt: string;
    url: string;
    contentType?: string;
  };
}

export interface MarketplaceOfferingsPage {
  items: MarketplaceOffering[];
  hasMore: boolean;
  nextCursor?: string;
}

/** @deprecated Legacy shape retained for discovery projection helpers. */
export interface Service {
  id?: string;
  vendorId?: string;
  categoryId?: string;
  name?: string;
  description?: string;
  vehiclePricing?: VehiclePricing[];
  durationMinutes?: number;
  vehicleTypes?: VehicleType[];
  basePrice?: number;
  active?: boolean;
  version?: number;
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
