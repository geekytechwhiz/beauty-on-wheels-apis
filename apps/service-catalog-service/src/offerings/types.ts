import { ServiceDiscoveryEntity } from '../types/service-discovery.types';

export const FILTER_OPERATOR = {
  EQ: 'eq',
  IN: 'in',
  GTE: 'gte',
  LTE: 'lte',
  BETWEEN: 'between',
} as const;

export type FilterOperator = (typeof FILTER_OPERATOR)[keyof typeof FILTER_OPERATOR];

export const OFFERING_STATUS = {
  ACTIVE: 'active',
} as const;

export type OfferingStatus = (typeof OFFERING_STATUS)[keyof typeof OFFERING_STATUS];

export const SORT_FIELD = {
  PRICE: 'price',
  DISTANCE: 'distance',
  RATING: 'rating',
  POPULARITY: 'popularity',
  NAME: 'name',
  NEWEST: 'newest',
  RELEVANCE: 'relevance',
} as const;

export type SortField = (typeof SORT_FIELD)[keyof typeof SORT_FIELD];

export const SORT_DIRECTION = {
  ASC: 'asc',
  DESC: 'desc',
} as const;

export type SortDirection = (typeof SORT_DIRECTION)[keyof typeof SORT_DIRECTION];

export type FilterValue =
  | string
  | number
  | readonly string[]
  | readonly [number, number];

export interface FilterClause {
  field: string;
  operator: FilterOperator;
  value: FilterValue;
}

export interface SortSpec {
  field: SortField;
  direction: SortDirection;
}

export interface OfferingLocation {
  latitude: number;
  longitude: number;
  radiusKm: number;
}

export interface ParsedOfferingsQuery {
  clauses: FilterClause[];
  search?: string;
  searchTerms: string[];
  location?: OfferingLocation;
  availableOn?: string;
  startTime?: string;
  sorts: SortSpec[];
  limit: number;
  cursor?: string;
  /** Required for customer marketplace discovery (community GSI3 path). */
  communityId: string;
}

export interface OfferingCandidate {
  entity: ServiceDiscoveryEntity;
  displayPrice: number;
  durationMinutes: number;
  vehicleTypes: string[];
  distanceKm?: number;
  relevanceScore: number;
  offeringKey: string;
}

export interface OfferingView {
  offeringId: string;
  serviceId: string;
  name: string;
  description?: string;
  categoryId: string;
  vendorId: string;
  /** Present when discovery has an operational branch; omitted for community-only packages. */
  branchId?: string;
  vehicleTypes: string[];
  displayPrice: number;
  currency: string;
  durationMinutes: number;
  distanceKm?: number;
  rating?: number;
  reviewCount?: number;
  status: OfferingStatus;
  imageUrl: {
    alt: string;
    url: string;
    contentType?: string;
  };
}

export interface OfferingsPage {
  items: OfferingView[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface BookableOfferingCheck {
  vendorId: string;
  branchId: string;
  offeringId: string;
  vehicles: Array<{
    vehicleType: string;
    durationMinutes: number;
  }>;
}

export interface BookableOfferingsRequest {
  date: string;
  startTime?: string;
  offerings: BookableOfferingCheck[];
}

export interface OfferingAvailabilitySource {
  findBookable(input: BookableOfferingsRequest): Promise<Set<string>>;
}

export const OFFERING_CANDIDATE_LIMIT = 5000;
export const DEFAULT_OFFERING_LIMIT = 20;
export const MAX_OFFERING_LIMIT = 50;
export const DEFAULT_RADIUS_KM = 10;
export const MAX_RADIUS_KM = 100;
export const MAX_IN_VALUES = 20;
export const MAX_FILTER_CLAUSES = 15;
export const MAX_SORT_FIELDS = 3;
export const MAX_AVAILABILITY_BRANCHES = 40;
export const MAX_AVAILABILITY_OFFERINGS = 500;
export const DISCOVERY_INDEX_NAME = 'GSI2';

export function offeringKey(
  entity: Pick<ServiceDiscoveryEntity, 'vendorId' | 'branchId' | 'serviceId'>,
): string {
  return [entity.vendorId, entity.branchId, entity.serviceId].join('#');
}
