export type DiscoverySortBy =
  | 'RELEVANCE'
  | 'DISTANCE_ASC'
  | 'PRICE_ASC'
  | 'PRICE_DESC'
  | 'RATING_DESC';

export interface ServiceDiscoveryQuery {
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

export interface ServiceDiscoveryEntity {
  PK: string;
  SK: string;
  entityType: 'SERVICE_DISCOVERY';
  /** Same value as PK. Lets discovery query GSI2 without using VENDOR# partitions. */
  GSI2PK: string;
  /** Same value as SK. */
  GSI2SK: string;

  serviceId: string;
  vendorId: string;
  branchId: string;
  categoryId: string;

  name: string;
  description?: string;
  normalizedName: string;
  searchText: string;
  durationMinutes: number;

  vehicleTypes: string[];
  displayPricesByVehicleType: Record<string, number>;
  /** Shortest duration. A selected vehicle uses durationMinutesByVehicleType. */
  durationMinutesByVehicleType?: Record<string, number>;
  basePrice: number;
  currency: 'INR';

  latitude?: number;
  longitude?: number;
  serviceRadiusKm?: number;

  rating?: number;
  reviewCount?: number;
  
  image:{
    alt: string;
    url: string;
    contentType: string;
  }
  active: boolean;
  vendorApproved: boolean;
  branchOperational: boolean;

  /** Canonical service updatedAt used for stale-write protection. */
  serviceUpdatedAt: string;
  /** Vendor review time. Empty until an approval fact is recorded. */
  vendorReviewedAt: string;
  /** Branch coverage time. Empty until a branch fact is recorded. */
  branchUpdatedAt: string;
  /** Provider price time. Empty until a price fact is recorded. */
  priceUpdatedAt: string;
}

/** Points at the global and category items for one service and branch. */
export interface DiscoveryPointerEntity {
  PK: string;
  SK: string;
  entityType: 'DISCOVERY_POINTER';
  serviceId: string;
  vendorId: string;
  categoryId: string;
  branchId: string;
  branchKey: string;
  globalPk: string;
  globalSk: string;
  categoryPk: string;
  categorySk: string;
  updatedAt: string;
}

export interface DiscoveryVendorState {
  PK: string;
  SK: string;
  entityType: 'DISCOVERY_VENDOR_STATE';
  vendorId: string;
  approved: boolean;
  reviewedAt: string;
  updatedAt: string;
}

export interface DiscoveryBranchState {
  PK: string;
  SK: string;
  entityType: 'DISCOVERY_BRANCH_STATE';
  vendorId: string;
  branchId: string;
  operational: boolean;
  latitude?: number;
  longitude?: number;
  serviceRadiusKm?: number;
  updatedAt: string;
}

export interface DiscoveryPriceState {
  PK: string;
  SK: string;
  entityType: 'DISCOVERY_PRICE_STATE';
  vendorId: string;
  serviceId: string;
  enabled: boolean;
  priceOverride?: number;
  updatedAt: string;
}

export interface DiscoveryWritePlan {
  items: ServiceDiscoveryEntity[];
  pointers: DiscoveryPointerEntity[];
  deletes: Array<{ PK: string; SK: string }>;
}

export interface ServiceDiscoveryResult extends ServiceDiscoveryEntity {
  displayPrice: number;
  distanceKm?: number;
  relevanceScore: number;
}

export interface ServiceDiscoveryPage {
  items: ServiceDiscoveryResult[];
  nextToken?: string;
  hasMore: boolean;
}
 