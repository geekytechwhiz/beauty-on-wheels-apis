import { ValidationError } from '@api-hub/utils';

import {
  DiscoveryBranchState,
  DiscoveryPointerEntity,
  DiscoveryPriceState,
  DiscoverySortBy,
  DiscoveryVendorState,
  DiscoveryWritePlan,
  ServiceDiscoveryEntity,
  ServiceDiscoveryQuery,
} from '../types/service-discovery.types';
import { PRICING_CURRENCY } from './pricing';
import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';
import { ServiceEntity } from '../utils/types/catalog-domain.types';

/** Key segment used when no branch coverage has been recorded. */
export const UNASSIGNED_BRANCH_KEY = 'UNASSIGNED';

const SORTS: readonly DiscoverySortBy[] = [
  'RELEVANCE',
  'DISTANCE_ASC',
  'PRICE_ASC',
  'PRICE_DESC',
  'RATING_DESC',
];

/**
 * Accepts API Gateway query strings and already-parsed numbers.
 * Missing coordinates stay absent. An empty string is absent, not zero.
 */
export function parseDiscoverServicesQuery(input: unknown): ServiceDiscoveryQuery {
  const source = isRecord(input) ? input : {};
  const latitude = optionalNumber(source.latitude, 'latitude');
  const longitude = optionalNumber(source.longitude, 'longitude');
  const radiusKm = optionalNumber(source.radiusKm, 'radiusKm');
  const minPrice = optionalNumber(source.minPrice, 'minPrice');
  const maxPrice = optionalNumber(source.maxPrice, 'maxPrice');
  const minRating = optionalNumber(source.minRating, 'minRating');
  const limit = optionalInteger(source.limit, 'limit');
  const sortBy = optionalSort(source.sortBy);
  const search = optionalText(source.search);
  const categoryId = optionalText(source.categoryId);
  const vehicleType = optionalText(source.vehicleType);
  const nextToken = optionalText(source.nextToken);

  if (limit !== undefined && (limit < 1 || limit > 50)) {
    throw new ValidationError('limit must be between 1 and 50');
  }
  if ((latitude === undefined) !== (longitude === undefined)) {
    throw new ValidationError('latitude and longitude must be provided together');
  }
  if (sortBy === 'DISTANCE_ASC' && (latitude === undefined || longitude === undefined)) {
    throw new ValidationError('Location is required for distance sorting');
  }
  if (
    (radiusKm !== undefined && (radiusKm <= 0 || radiusKm > 100))
    || (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice)
  ) {
    throw new ValidationError('Invalid discovery filters');
  }

  return {
    search,
    categoryId,
    latitude,
    longitude,
    radiusKm,
    vehicleType,
    minPrice,
    maxPrice,
    minRating,
    sortBy,
    limit,
    nextToken,
  };
}

export function discoveryBranchKey(branchId: string): string {
  const trimmed = branchId.trim();
  return trimmed.length > 0 ? trimmed : UNASSIGNED_BRANCH_KEY;
}

export function vendorStatusIsApproved(status: string): boolean {
  return status === 'ACTIVE';
}

export interface DiscoveryProjectionInput {
  service: ServiceEntity;
  vendor: DiscoveryVendorState | null;
  branches: readonly DiscoveryBranchState[];
  price: DiscoveryPriceState | null;
  existingPointers: readonly DiscoveryPointerEntity[];
}

/**
 * Builds the global and category discovery items for one service.
 * Missing vendor or branch facts stay ineligible. They are not treated as approved.
 */
export function buildDiscoveryWritePlan(input: DiscoveryProjectionInput): DiscoveryWritePlan {
  const targets = coverageTargets(input.branches);
  const items: ServiceDiscoveryEntity[] = [];
  const pointers: DiscoveryPointerEntity[] = [];

  for (const target of targets) {
    const branchKey = discoveryBranchKey(target.branchId);
    const globalPk = CatalogKeyBuilder.discoveryAllPk();
    const categoryPk = CatalogKeyBuilder.discoveryCategoryPk(input.service.categoryId);
    const sortKey = CatalogKeyBuilder.discoveryItemSk(input.service.serviceId, branchKey);
    const shared = discoveryBody(input, target);

    items.push(discoveryItem(globalPk, sortKey, shared));
    items.push(discoveryItem(categoryPk, sortKey, shared));
    pointers.push({
      PK: CatalogKeyBuilder.discoveryServicePk(input.service.serviceId),
      SK: CatalogKeyBuilder.discoveryPointerSk(branchKey),
      entityType: 'DISCOVERY_POINTER',
      serviceId: input.service.serviceId,
      vendorId: input.service.vendorId,
      categoryId: input.service.categoryId,
      branchId: target.branchId,
      branchKey,
      globalPk,
      globalSk: sortKey,
      categoryPk,
      categorySk: sortKey,
      updatedAt: input.service.updatedAt,
    });
  }

  const nextKeys = new Set(pointers.map((pointer) => `${pointer.PK}|${pointer.SK}`));
  const deletes: Array<{ PK: string; SK: string }> = [];
  for (const pointer of input.existingPointers) {
    if (nextKeys.has(`${pointer.PK}|${pointer.SK}`)) {
      continue;
    }
    deletes.push(
      { PK: pointer.PK, SK: pointer.SK },
      { PK: pointer.globalPk, SK: pointer.globalSk },
      { PK: pointer.categoryPk, SK: pointer.categorySk },
    );
  }

  return { items, pointers, deletes };
}

export function discoveryWriteBlocked(
  existing: Pick<
    ServiceDiscoveryEntity,
    'serviceUpdatedAt' | 'vendorReviewedAt' | 'branchUpdatedAt' | 'priceUpdatedAt'
  > | undefined,
  incoming: Pick<
    ServiceDiscoveryEntity,
    'serviceUpdatedAt' | 'vendorReviewedAt' | 'branchUpdatedAt' | 'priceUpdatedAt'
  >,
): boolean {
  if (!existing) {
    return false;
  }
  return (
    (existing.serviceUpdatedAt ?? '') > incoming.serviceUpdatedAt
    || (existing.vendorReviewedAt ?? '') > incoming.vendorReviewedAt
    || (existing.branchUpdatedAt ?? '') > incoming.branchUpdatedAt
    || (existing.priceUpdatedAt ?? '') > incoming.priceUpdatedAt
  );
}

export function sameDiscoveryProjection(
  existing: ServiceDiscoveryEntity,
  incoming: ServiceDiscoveryEntity,
): boolean {
  return discoverySignature(existing) === discoverySignature(incoming);
}

export const DISCOVERY_FRESHNESS_CONDITION = [
  'attribute_not_exists(PK)',
  'OR (',
  '(attribute_not_exists(serviceUpdatedAt) OR serviceUpdatedAt <= :serviceUpdatedAt)',
  'AND (attribute_not_exists(vendorReviewedAt) OR vendorReviewedAt <= :vendorReviewedAt)',
  'AND (attribute_not_exists(branchUpdatedAt) OR branchUpdatedAt <= :branchUpdatedAt)',
  'AND (attribute_not_exists(priceUpdatedAt) OR priceUpdatedAt <= :priceUpdatedAt)',
  ')',
].join(' ');

export function discoveryFreshnessValues(item: ServiceDiscoveryEntity): Record<string, string> {
  return {
    ':serviceUpdatedAt': item.serviceUpdatedAt,
    ':vendorReviewedAt': item.vendorReviewedAt,
    ':branchUpdatedAt': item.branchUpdatedAt,
    ':priceUpdatedAt': item.priceUpdatedAt,
  };
}

function coverageTargets(branches: readonly DiscoveryBranchState[]): DiscoveryBranchState[] {
  if (branches.length === 0) {
    return [{
      PK: '',
      SK: '',
      entityType: 'DISCOVERY_BRANCH_STATE',
      vendorId: '',
      branchId: '',
      operational: false,
      updatedAt: '',
    }];
  }
  return [...branches];
}

function discoveryBody(
  input: DiscoveryProjectionInput,
  branch: DiscoveryBranchState,
): Omit<ServiceDiscoveryEntity, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
  const name = input.service.name.trim();
  const description = input.service.description?.trim();
  const searchText = [name, description ?? '', ...input.service.vehicleTypes]
    .join(' ')
    .toLowerCase();
  const latitude = finite(branch.latitude);
  const longitude = finite(branch.longitude);
  const serviceRadiusKm = finite(branch.serviceRadiusKm);

  return {
    entityType: 'SERVICE_DISCOVERY',
    serviceId: input.service.serviceId,
    vendorId: input.service.vendorId,
    branchId: branch.branchId,
    categoryId: input.service.categoryId,
    name,
    ...(description ? { description } : {}),
    normalizedName: name.toLowerCase(),
    searchText,
    durationMinutes: input.service.durationMinutes,
    vehicleTypes: [...input.service.vehicleTypes],
    displayPricesByVehicleType: displayPrices(input.service, input.price),
    basePrice: input.price?.priceOverride ?? input.service.basePrice,
    currency: PRICING_CURRENCY,
    ...(latitude === undefined ? {} : { latitude }),
    ...(longitude === undefined ? {} : { longitude }),
    ...(serviceRadiusKm === undefined ? {} : { serviceRadiusKm }),
    active: input.service.active,
    vendorApproved: input.vendor?.approved === true,
    branchOperational: branch.branchId !== '' && branch.operational === true,
    serviceUpdatedAt: input.service.updatedAt,
    vendorReviewedAt: input.vendor?.reviewedAt ?? '',
    branchUpdatedAt: branch.updatedAt ?? '',
    priceUpdatedAt: input.price?.updatedAt ?? '',
  };
}

function displayPrices(
  service: ServiceEntity,
  price: DiscoveryPriceState | null,
): Record<string, number> {
  if (price && price.enabled === false) {
    return {};
  }
  const amount = price?.priceOverride ?? service.basePrice;
  const prices: Record<string, number> = {};
  for (const vehicleType of service.vehicleTypes) {
    prices[vehicleType] = amount;
  }
  return prices;
}

function discoveryItem(
  pk: string,
  sk: string,
  body: Omit<ServiceDiscoveryEntity, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'>,
): ServiceDiscoveryEntity {
  return {
    PK: pk,
    SK: sk,
    GSI2PK: pk,
    GSI2SK: sk,
    ...body,
  };
}

function discoverySignature(item: ServiceDiscoveryEntity): string {
  return JSON.stringify({
    PK: item.PK,
    SK: item.SK,
    serviceId: item.serviceId,
    vendorId: item.vendorId,
    branchId: item.branchId,
    categoryId: item.categoryId,
    name: item.name,
    description: item.description ?? '',
    searchText: item.searchText,
    durationMinutes: item.durationMinutes,
    vehicleTypes: item.vehicleTypes,
    displayPricesByVehicleType: item.displayPricesByVehicleType,
    basePrice: item.basePrice,
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
    serviceRadiusKm: item.serviceRadiusKm ?? null,
    active: item.active,
    vendorApproved: item.vendorApproved,
    branchOperational: item.branchOperational,
    serviceUpdatedAt: item.serviceUpdatedAt,
    vendorReviewedAt: item.vendorReviewedAt,
    branchUpdatedAt: item.branchUpdatedAt,
    priceUpdatedAt: item.priceUpdatedAt,
  });
}

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalSort(value: unknown): DiscoverySortBy | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'string' && SORTS.includes(value as DiscoverySortBy)) {
    return value as DiscoverySortBy;
  }
  throw new ValidationError('Invalid discovery sort');
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  throw new ValidationError(`${field} must be a number`);
}

function optionalInteger(value: unknown, field: string): number | undefined {
  const parsed = optionalNumber(value, field);
  if (parsed === undefined) {
    return undefined;
  }
  if (!Number.isInteger(parsed)) {
    throw new ValidationError(`${field} must be an integer`);
  }
  return parsed;
}
