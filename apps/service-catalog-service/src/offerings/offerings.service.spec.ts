import { ServiceDiscoveryEntity } from '../types/service-discovery.types';
import { parseBookableKeys } from './availability-bookable.client';
import { OfferingsService } from './offerings.service';
import { BookableOfferingsRequest } from './types';

function discovery(serviceId: string, price: number, branchId = 'branch-1'): ServiceDiscoveryEntity {
  return {
    PK: 'DISCOVERY#ALL',
    SK: `SERVICE#${serviceId}#BRANCH#${branchId || 'NONE'}`,
    entityType: 'SERVICE_DISCOVERY',
    GSI2PK: 'DISCOVERY#ALL',
    GSI2SK: `SERVICE#${serviceId}#BRANCH#${branchId || 'NONE'}`,
    serviceId,
    vendorId: 'vendor-1',
    branchId,
    categoryId: 'cat-1',
    name: serviceId,
    normalizedName: serviceId,
    searchText: serviceId,
    durationMinutes: 30,
    vehicleTypes: ['SUV'],
    displayPricesByVehicleType: { SUV: price },
    durationMinutesByVehicleType: { SUV: 30 },
    basePrice: price,
    currency: 'INR',
    latitude: 12.97,
    longitude: 77.59,
    serviceRadiusKm: 10,
    rating: 4,
    reviewCount: 1,
    active: true,
    vendorApproved: true,
    branchOperational: Boolean(branchId.trim()),
    serviceUpdatedAt: '2026-10-01T00:00:00.000Z',
    vendorReviewedAt: '2026-10-01T00:00:00.000Z',
    branchUpdatedAt: '2026-10-01T00:00:00.000Z',
    priceUpdatedAt: '2026-10-01T00:00:00.000Z',
  };
}

function communityMapping(serviceId: string, communityId = 'community-1') {
  return {
    PK: `SERVICE#${serviceId}`,
    SK: `COMMUNITY#${communityId}`,
    entityType: 'OfferingCommunity' as const,
    vendorId: 'vendor-1',
    categoryId: 'cat-1',
    serviceId,
    communityId,
    status: 'active' as const,
    serviceActive: true,
    version: 1,
    GSI3PK: `COMMUNITY#${communityId}`,
    GSI3SK: `SERVICE#cat-1#${serviceId}`,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

describe('OfferingsService', () => {
  it('requires communityId and rejects global discovery without it', async () => {
    const service = new OfferingsService(
      { findBookable: jest.fn() },
      {
        async queryActivePage() {
          throw new Error('community index should stay unused');
        },
        async listDiscoveryRows() {
          return [];
        },
      },
    );
    await expect(service.listOfferings({ categoryId: 'cat-1', limit: 10 })).rejects.toMatchObject({
      message: expect.stringMatching(/communityId is required/i),
    });
  });

  it('queries community GSI3 and returns an empty page when the community has no mappings', async () => {
    const queried: string[] = [];
    const service = new OfferingsService(
      { findBookable: jest.fn() },
      {
        async queryActivePage(input) {
          queried.push(input.communityId);
          return { items: [] };
        },
        async listDiscoveryRows() {
          throw new Error('discovery rows should stay unused when the community page is empty');
        },
      },
    );

    const page = await service.listOfferings({ communityId: 'community-1', categoryId: 'cat-1', limit: 10 });
    expect(queried).toEqual(['community-1']);
    expect(page).toEqual({ items: [], hasMore: false });
  });

  it('filters by community through GSI3 and still returns branchId', async () => {
    const queried: string[] = [];
    const service = new OfferingsService(
      { findBookable: jest.fn() },
      {
        async queryActivePage(input) {
          queried.push(input.communityId);
          return { items: [communityMapping('low')] };
        },
        async listDiscoveryRows() {
          return [discovery('low', 100, 'branch-9')];
        },
      },
    );

    const page = await service.listOfferings({ communityId: 'community-1', limit: 10 });
    expect(queried).toEqual(['community-1']);
    expect(page.items).toEqual([
      expect.objectContaining({ serviceId: 'low', offeringId: 'low', branchId: 'branch-9' }),
    ]);
  });

  it('keeps branchless community offerings eligible when branch coverage is absent', async () => {
    const service = new OfferingsService(
      { findBookable: jest.fn() },
      {
        async queryActivePage() {
          return { items: [communityMapping('pkg-1')] };
        },
        async listDiscoveryRows() {
          return [discovery('pkg-1', 199, '')];
        },
      },
    );

    const page = await service.listOfferings({ communityId: 'community-1', limit: 10 });
    expect(page.items).toEqual([
      expect.objectContaining({
        serviceId: 'pkg-1',
        offeringId: 'pkg-1',
        displayPrice: 199,
        status: 'active',
      }),
    ]);
    expect(page.items[0]).not.toHaveProperty('branchId');
  });

  it('drops offerings that are not bookable before cutting the page', async () => {
    const calls: BookableOfferingsRequest[] = [];
    const mappings = [
      communityMapping('low'),
      communityMapping('mid'),
      communityMapping('high'),
    ];
    const service = new OfferingsService(
      {
        async findBookable(input: BookableOfferingsRequest) {
          calls.push(input);
          return new Set(['vendor-1#branch-1#low', 'vendor-1#branch-1#high']);
        },
      },
      {
        async queryActivePage(input) {
          const start = input.exclusiveStartKey
            ? mappings.findIndex((item) =>
              item.PK === input.exclusiveStartKey?.PK
              && item.SK === input.exclusiveStartKey?.SK) + 1
            : 0;
          const items = start > 0 ? mappings.slice(start) : mappings;
          return { items };
        },
        async listDiscoveryRows(serviceId: string) {
          const prices: Record<string, number> = { low: 100, mid: 200, high: 300 };
          return [discovery(serviceId, prices[serviceId] ?? 100)];
        },
      },
    );

    const first = await service.listOfferings({
      communityId: 'community-1',
      sort: 'price:asc',
      limit: 1,
      availableOn: '2026-12-01',
      vehicleType: 'SUV',
    });
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(first.items.map((item) => item.offeringId)).toEqual(['low']);
    expect(first.hasMore).toBe(true);

    const second = await service.listOfferings({
      communityId: 'community-1',
      sort: 'price:asc',
      limit: 1,
      availableOn: '2026-12-01',
      vehicleType: 'SUV',
      cursor: first.nextCursor,
    });
    expect(second.items.map((item) => item.offeringId)).toEqual(['high']);
    expect(second.items[0]).toMatchObject({
      offeringId: 'high',
      serviceId: 'high',
      displayPrice: 300,
      currency: 'INR',
      status: 'active',
      vehicleTypes: ['SUV'],
    });
  });

  it('does not call availability unless availableOn is set', async () => {
    const findBookable = jest.fn();
    const service = new OfferingsService(
      { findBookable },
      {
        async queryActivePage() {
          return { items: [communityMapping('low')] };
        },
        async listDiscoveryRows() {
          return [discovery('low', 100)];
        },
      },
    );
    const page = await service.listOfferings({ communityId: 'community-1', limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(findBookable).not.toHaveBeenCalled();
  });

  it('fails closed when community discovery is not configured', async () => {
    const service = new OfferingsService({ findBookable: jest.fn() }, null);
    await expect(service.listOfferings({ communityId: 'community-1', limit: 10 })).rejects.toMatchObject({
      statusCode: 503,
      code: 'COMMUNITY_OFFERING_UNAVAILABLE',
    });
  });
});

describe('parseBookableKeys', () => {
  it('reads offering keys and rejects an unreadable payload', () => {
    expect([...parseBookableKeys({ keys: ['vendor-1#branch-1#svc-1'] })]).toEqual([
      'vendor-1#branch-1#svc-1',
    ]);
    expect(() => parseBookableKeys({ keys: [1] })).toThrow(/Availability/);
  });
});
