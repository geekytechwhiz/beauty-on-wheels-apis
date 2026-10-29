import { ValidationError } from '@api-hub/utils';

import { applyCatalogFilters } from './filter-registry';
import { parseOfferingsQuery } from './parse-offerings-query';
import { selectDiscoveryPartition } from './query-planner';
import { compareOfferings } from './sort-registry';
import { pageOfferings } from './cursor';
import { ServiceDiscoveryEntity } from '../types/service-discovery.types';
import { OfferingCandidate } from './types';

function discovery(overrides: Partial<ServiceDiscoveryEntity> = {}): ServiceDiscoveryEntity {
  const serviceId = overrides.serviceId ?? 'svc-polish';
  const branchId = overrides.branchId ?? 'branch-1';
  return {
    PK: 'DISCOVERY#ALL',
    SK: `SERVICE#${serviceId}#BRANCH#${branchId}`,
    entityType: 'SERVICE_DISCOVERY',
    GSI2PK: 'DISCOVERY#ALL',
    GSI2SK: `SERVICE#${serviceId}#BRANCH#${branchId}`,
    serviceId,
    vendorId: 'vendor-1',
    branchId,
    categoryId: 'cat-1',
    name: 'Interior polish',
    description: 'Full cabin',
    normalizedName: 'interior polish',
    searchText: 'interior polish full cabin ceramic suv',
    durationMinutes: 60,
    vehicleTypes: ['SUV', 'SEDAN'],
    displayPricesByVehicleType: { SUV: 800, SEDAN: 500 },
    durationMinutesByVehicleType: { SUV: 70, SEDAN: 50 },
    basePrice: 500,
    currency: 'INR',
    latitude: 12.97,
    longitude: 77.59,
    serviceRadiusKm: 15,
    rating: 4.6,
    reviewCount: 12,
    active: true,
    vendorApproved: true,
    branchOperational: true,
    serviceUpdatedAt: '2026-10-01T00:00:00.000Z',
    vendorReviewedAt: '2026-10-01T00:00:00.000Z',
    branchUpdatedAt: '2026-10-01T00:00:00.000Z',
    priceUpdatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function candidates(items: ServiceDiscoveryEntity[], query: Parameters<typeof applyCatalogFilters>[1]): OfferingCandidate[] {
  return applyCatalogFilters(items, query).sort((left, right) => compareOfferings(left, right, query.sorts));
}

describe('offerings query', () => {
  const combined = {
    communityId: 'community-1',
    search: 'ceramic',
    categoryId: 'cat-1',
    vehicleType: 'SUV,SEDAN',
    vendorId: 'vendor-1',
    branchId: 'branch-1',
    minPrice: '100',
    maxPrice: '900',
    minRating: '4',
    status: 'active',
    latitude: '12.97',
    longitude: '77.59',
    radiusKm: '10',
    sort: 'price:asc,rating:desc',
    limit: '20',
  };

  it('keeps a row that matches search, category, vehicles, price, rating, status, and radius', () => {
    const query = parseOfferingsQuery(combined);
    const matched = applyCatalogFilters([
      discovery(),
      discovery({ serviceId: 'other-category', categoryId: 'cat-2' }),
      discovery({ serviceId: 'too-costly', displayPricesByVehicleType: { SUV: 2000, SEDAN: 1900 }, basePrice: 1900 }),
      discovery({ serviceId: 'low-rating', rating: 3 }),
      discovery({ serviceId: 'inactive', active: false }),
      discovery({ serviceId: 'unapproved', vendorApproved: false }),
      // Non-operational branch coverage stays eligible for community discovery.
      discovery({ serviceId: 'closed', branchOperational: false }),
      discovery({ serviceId: 'bike-only', vehicleTypes: ['BIKE'], displayPricesByVehicleType: { BIKE: 100 }, basePrice: 100 }),
      discovery({ serviceId: 'far', latitude: 0, longitude: 0 }),
      discovery({
        serviceId: 'outside-vendor-radius',
        latitude: 13.2,
        longitude: 77.59,
        serviceRadiusKm: 1,
      }),
      discovery({ serviceId: 'no-keyword', name: 'Basic wash', normalizedName: 'basic wash', searchText: 'basic wash', description: 'Soap' }),
    ], query);

    expect(matched.map((item) => item.entity.serviceId)).toEqual(['svc-polish', 'closed']);
    expect(matched[0].displayPrice).toBe(500);
    expect(matched[0].vehicleTypes).toEqual(['SUV', 'SEDAN']);
    expect(matched[0].durationMinutes).toBe(50);
    expect(selectDiscoveryPartition(query.clauses)).toBe('DISCOVERY#CATEGORY#cat-1');
  });

  it('sorts by price, then rating, then offering key', () => {
    const query = parseOfferingsQuery({ communityId: 'community-1', sort: 'price:asc,rating:desc', limit: 10 });
    const ordered = candidates([
      discovery({ serviceId: 'high', vendorId: 'vendor-b', basePrice: 300, displayPricesByVehicleType: { SUV: 300, SEDAN: 300 }, rating: 5 }),
      discovery({ serviceId: 'tie-b', vendorId: 'vendor-b', basePrice: 100, displayPricesByVehicleType: { SUV: 100, SEDAN: 100 }, rating: 4 }),
      discovery({ serviceId: 'tie-a', vendorId: 'vendor-a', basePrice: 100, displayPricesByVehicleType: { SUV: 100, SEDAN: 100 }, rating: 4 }),
      discovery({ serviceId: 'same-price-better', vendorId: 'vendor-c', basePrice: 100, displayPricesByVehicleType: { SUV: 100, SEDAN: 100 }, rating: 5 }),
    ], query);

    expect(ordered.map((item) => item.entity.serviceId)).toEqual([
      'same-price-better',
      'tie-a',
      'tie-b',
      'high',
    ]);
  });

  it('pages with a keyset cursor and does not repeat an inserted earlier row', () => {
    const firstQuery = parseOfferingsQuery({ communityId: 'community-1', sort: 'price:asc', limit: 1 });
    const first = candidates([
      discovery({ serviceId: 'mid', basePrice: 200, displayPricesByVehicleType: { SUV: 200, SEDAN: 200 } }),
      discovery({ serviceId: 'low', basePrice: 100, displayPricesByVehicleType: { SUV: 100, SEDAN: 100 } }),
      discovery({ serviceId: 'high', basePrice: 300, displayPricesByVehicleType: { SUV: 300, SEDAN: 300 } }),
    ], firstQuery);
    const firstPage = pageOfferings(first, firstQuery);
    expect(firstPage.items.map((item) => item.entity.serviceId)).toEqual(['low']);
    expect(firstPage.hasMore).toBe(true);

    const secondQuery = parseOfferingsQuery({
      communityId: 'community-1',
      sort: 'price:asc',
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    const expanded = candidates([
      discovery({ serviceId: 'inserted', basePrice: 50, displayPricesByVehicleType: { SUV: 50, SEDAN: 50 } }),
      discovery({ serviceId: 'mid', basePrice: 200, displayPricesByVehicleType: { SUV: 200, SEDAN: 200 } }),
      discovery({ serviceId: 'low', basePrice: 100, displayPricesByVehicleType: { SUV: 100, SEDAN: 100 } }),
      discovery({ serviceId: 'high', basePrice: 300, displayPricesByVehicleType: { SUV: 300, SEDAN: 300 } }),
    ], secondQuery);
    const secondPage = pageOfferings(expanded, secondQuery);
    expect(secondPage.items.map((item) => item.entity.serviceId)).toEqual(['mid']);
  });

  it('rejects a cursor from a different filter and returns no cursor for an empty page', () => {
    const priced = parseOfferingsQuery({
      communityId: 'community-1',
      sort: 'price:asc',
      limit: 1,
      minPrice: '10',
    });
    const page = pageOfferings(candidates([
      discovery({ basePrice: 100, displayPricesByVehicleType: { SUV: 100, SEDAN: 100 } }),
      discovery({ serviceId: 'other', basePrice: 200, displayPricesByVehicleType: { SUV: 200, SEDAN: 200 } }),
    ], priced), priced);
    const changed = parseOfferingsQuery({
      communityId: 'community-1',
      sort: 'price:asc',
      limit: 1,
      minPrice: '10',
      categoryId: 'cat-9',
      cursor: page.nextCursor,
    });
    expect(() => pageOfferings([], changed)).toThrow(ValidationError);

    const empty = pageOfferings([], parseOfferingsQuery({
      communityId: 'community-1',
      search: 'missing',
      limit: 5,
    }));
    expect(empty).toEqual({ items: [], hasMore: false, nextCursor: undefined });
  });

  it('rejects invalid limits, operators, vehicle types, coordinates, and cursors', () => {
    expect(() => parseOfferingsQuery({ limit: 0 })).toThrow(/communityId is required/);
    expect(() => parseOfferingsQuery({ communityId: 'community-1', limit: 0 })).toThrow(ValidationError);
    expect(() => parseOfferingsQuery({ communityId: 'community-1', limit: 51 })).toThrow(ValidationError);
    expect(() => parseOfferingsQuery({ communityId: '!!bad', limit: 10 })).toThrow(/Invalid communityId/);
    expect(() => parseOfferingsQuery({ communityId: 'community-1', filter: 'vehicleType:like:SUV' })).toThrow(/Unsupported operator/);
    expect(() => parseOfferingsQuery({ communityId: 'community-1', vehicleType: 'CAR' })).toThrow(expect.objectContaining({
      code: 'INVALID_VEHICLE_TYPE',
      statusCode: 400,
    }));
    expect(() => parseOfferingsQuery({ communityId: 'community-1', latitude: 12.97 })).toThrow(/together/);
    expect(() => parseOfferingsQuery({ communityId: 'community-1', status: 'inactive' })).toThrow(/status/);
    expect(() => parseOfferingsQuery({
      communityId: 'community-1',
      sort: 'price:asc',
      cursor: 'not-a-cursor',
    })).not.toThrow();
    expect(() => pageOfferings([], parseOfferingsQuery({
      communityId: 'community-1',
      cursor: '%%%',
    }))).toThrow(/cursor/i);
    expect(() => parseOfferingsQuery({
      communityId: 'community-1',
      categoryId: 'cat-1',
      filter: 'categoryId:eq:cat-1',
    })).toThrow(/more than once/);
    expect(selectDiscoveryPartition([])).toBe('DISCOVERY#ALL');
  });

  it('accepts a generic filter expression and defaults the sort', () => {
    const searched = parseOfferingsQuery({
      communityId: 'community-1',
      search: 'Polish',
      filter: ['price:between:100,800', 'rating:gte:4'],
    });
    expect(searched.search).toBe('polish');
    expect(searched.communityId).toBe('community-1');
    expect(searched.sorts).toEqual([{ field: 'relevance', direction: 'desc' }]);
    expect(searched.clauses).toEqual([
      { field: 'price', operator: 'between', value: [100, 800] },
      { field: 'rating', operator: 'gte', value: 4 },
    ]);

    const located = parseOfferingsQuery({
      communityId: 'community-1',
      latitude: 12.97,
      longitude: 77.59,
    });
    expect(located.location?.radiusKm).toBe(10);
    expect(located.sorts).toEqual([{ field: 'distance', direction: 'asc' }]);
    expect(parseOfferingsQuery({ communityId: 'community-1' }).sorts).toEqual([
      { field: 'newest', direction: 'desc' },
    ]);
  });
});
