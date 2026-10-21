import { ServiceDiscoveryEntity } from '../types/service-discovery.types';
import { parseBookableKeys } from './availability-bookable.client';
import { OfferingsService } from './offerings.service';
import { DiscoveryPartitionPage } from './offerings.repository';
import { BookableOfferingsRequest } from './types';

function discovery(serviceId: string, price: number, branchId = 'branch-1'): ServiceDiscoveryEntity {
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
    branchOperational: true,
    serviceUpdatedAt: '2026-10-01T00:00:00.000Z',
    vendorReviewedAt: '2026-10-01T00:00:00.000Z',
    branchUpdatedAt: '2026-10-01T00:00:00.000Z',
    priceUpdatedAt: '2026-10-01T00:00:00.000Z',
  };
}

describe('OfferingsService', () => {
  it('queries the category partition and returns an empty page', async () => {
    const partitions: string[] = [];
    const service = new OfferingsService(
      {
        async listDiscoveryPartition(partitionKey: string): Promise<DiscoveryPartitionPage> {
          partitions.push(partitionKey);
          return { items: [], truncated: false };
        },
      },
      { findBookable: jest.fn() },
    );

    const page = await service.listOfferings({ categoryId: 'cat-1', limit: 10 });
    expect(partitions).toEqual(['DISCOVERY#CATEGORY#cat-1']);
    expect(page).toEqual({ items: [], hasMore: false });
  });

  it('drops offerings that are not bookable before cutting the page', async () => {
    const calls: BookableOfferingsRequest[] = [];
    const items = [
      discovery('low', 100),
      discovery('mid', 200),
      discovery('high', 300),
    ];
    const service = new OfferingsService(
      {
        async listDiscoveryPartition(): Promise<DiscoveryPartitionPage> {
          return { items, truncated: false };
        },
      },
      {
        async findBookable(input: BookableOfferingsRequest) {
          calls.push(input);
          return new Set(['vendor-1#branch-1#low', 'vendor-1#branch-1#high']);
        },
      },
    );

    const first = await service.listOfferings({
      sort: 'price:asc',
      limit: 1,
      availableOn: '2026-12-01',
      vehicleType: 'SUV',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].offerings.map((offering) => offering.offeringId)).toEqual(['low', 'mid', 'high']);
    expect(first.items.map((item) => item.offeringId)).toEqual(['low']);
    expect(first.hasMore).toBe(true);

    const second = await service.listOfferings({
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

  it('does not call availability unless availableOn is set and rejects an oversized branch set', async () => {
    const findBookable = jest.fn();
    const wide = Array.from({ length: 41 }, (_value, index) => discovery(
      `svc-${index}`,
      100 + index,
      `branch-${index}`,
    ));
    const service = new OfferingsService(
      {
        async listDiscoveryPartition(): Promise<DiscoveryPartitionPage> {
          return { items: wide, truncated: false };
        },
      },
      { findBookable },
    );

    await expect(service.listOfferings({ availableOn: '2026-12-01', limit: 10 })).rejects.toMatchObject({
      statusCode: 400,
      code: 'AVAILABILITY_FILTER_TOO_BROAD',
    });
    expect(findBookable).not.toHaveBeenCalled();

    const plain = new OfferingsService(
      {
        async listDiscoveryPartition(): Promise<DiscoveryPartitionPage> {
          return { items: [discovery('low', 100)], truncated: false };
        },
      },
      { findBookable },
    );
    const page = await plain.listOfferings({ limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(findBookable).not.toHaveBeenCalled();
  });

  it('fails closed when the discovery partition is larger than the candidate cap', async () => {
    const service = new OfferingsService(
      {
        async listDiscoveryPartition(): Promise<DiscoveryPartitionPage> {
          return { items: [], truncated: true };
        },
      },
      { findBookable: jest.fn() },
    );
    await expect(service.listOfferings({ limit: 10 })).rejects.toMatchObject({
      statusCode: 503,
      code: 'OFFERING_CANDIDATE_LIMIT',
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
