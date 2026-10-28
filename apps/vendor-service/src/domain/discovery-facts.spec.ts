import { buildDiscoveryFacts, coverageForBranch } from './discovery-facts';
import {
  ServiceAreaDdbItem,
  VendorBranchDdbItem,
  VendorCapabilitiesDdbItem,
  VendorDdbItem,
} from '../types/repository.types';

function vendor(overrides: Partial<VendorDdbItem> = {}): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'PROFILE',
    vendorId: 'vendor-1',
    ownerUserId: 'user-1',
    status: 'ACTIVE',
    operationalStatus: 'ONLINE',
    onboardingStatus: 'COMPLETED',
    currentSection: 'SERVICE_LOCATION_AND_COVERAGE',
    completedSections: [],
    phoneNumber: '9999999999',
    email: 'vendor@example.com',
    latestReview: {
      previousStatus: 'PENDING_VERIFICATION',
      newStatus: 'ACTIVE',
      reviewerUserId: 'admin-1',
      reviewedAt: '2026-02-01T00:00:00.000Z',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    GSI1PK: 'STATUS#ACTIVE',
    GSI1SK: 'STATUS#ACTIVE#OPERATIONAL#ONLINE#2026-01-01T00:00:00.000Z#vendor-1',
    entityType: 'Vendor',
    ...overrides,
  };
}

function branch(overrides: Partial<VendorBranchDdbItem> = {}): VendorBranchDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'BRANCH#branch-1',
    branchId: 'branch-1',
    vendorId: 'vendor-1',
    name: 'Indiranagar',
    phoneNumber: '8888888888',
    email: 'branch@example.com',
    geoLocation: { latitude: 12.97, longitude: 77.64 },
    isPrimary: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
    entityType: 'VendorBranch',
    ...overrides,
  };
}

function area(overrides: Partial<ServiceAreaDdbItem> = {}): ServiceAreaDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'SERVICE_AREA#area-1',
    serviceAreaId: 'area-1',
    vendorId: 'vendor-1',
    name: 'Central',
    city: 'Bengaluru',
    center: { latitude: 12.97, longitude: 77.59 },
    radiusKm: 12,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-03T00:00:00.000Z',
    entityType: 'ServiceArea',
    ...overrides,
  };
}

describe('vendor discovery facts', () => {
  it('copies approval, branch location, coverage, and prices without contact details', () => {
    const capabilities = {
      PK: 'VENDOR#vendor-1',
      SK: 'CAPABILITIES',
      vendorId: 'vendor-1',
      vehicleTypes: ['SUV'],
      serviceIds: ['svc-1'],
      packageIds: [],
      services: [{ serviceId: 'svc-1', enabled: true, priceOverride: 499 }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      entityType: 'VendorCapabilities',
    } as VendorCapabilitiesDdbItem;

    const facts = buildDiscoveryFacts({
      vendor: vendor(),
      branches: [branch()],
      areas: [{ ...area(), radiusKm: 15 }],
      capabilities,
    });

    expect(facts).toEqual({
      vendorId: 'vendor-1',
      status: 'ACTIVE',
      reviewedAt: '2026-02-01T00:00:00.000Z',
      acceptingWork: true,
      communityIds: [],
      branches: [{
        branchId: 'branch-1',
        operational: true,
        latitude: 12.97,
        longitude: 77.64,
        serviceRadiusKm: 15,
        updatedAt: '2026-02-03T00:00:00.000Z',
      }],
      services: [{
        serviceId: 'svc-1',
        enabled: true,
        priceOverride: 499,
        updatedAt: '2026-03-01T00:00:00.000Z',
      }],
    });
    expect(JSON.stringify(facts)).not.toContain('9999999999');
    expect(JSON.stringify(facts)).not.toContain('vendor@example.com');
  });

  it('marks every branch unavailable when the vendor is not accepting work', () => {
    const facts = buildDiscoveryFacts({
      vendor: vendor({ operationalStatus: 'OFFLINE', status: 'SUSPENDED' }),
      branches: [branch()],
      areas: [area()],
      capabilities: null,
    });
    expect(facts.acceptingWork).toBe(false);
    expect(facts.branches[0]?.operational).toBe(false);
    expect(facts.services).toEqual([]);
  });

  it('uses the nearest active service area when a vendor covers more than one', () => {
    const near = area({
      serviceAreaId: 'near',
      center: { latitude: 12.971, longitude: 77.641 },
      radiusKm: 8,
      updatedAt: '2026-04-01T00:00:00.000Z',
    });
    const far = area({
      serviceAreaId: 'far',
      center: { latitude: 28.6, longitude: 77.2 },
      radiusKm: 30,
      updatedAt: '2026-05-01T00:00:00.000Z',
    });
    expect(coverageForBranch(
      { latitude: 12.97, longitude: 77.64, updatedAt: '2026-02-02T00:00:00.000Z' },
      [far, near],
    )).toEqual({
      serviceRadiusKm: 8,
      updatedAt: '2026-04-01T00:00:00.000Z',
    });
  });

  it('does not choose among several areas when the branch has no coordinates', () => {
    expect(coverageForBranch(
      { updatedAt: '2026-02-02T00:00:00.000Z' },
      [area({ serviceAreaId: 'a', radiusKm: 5 }), area({ serviceAreaId: 'b', radiusKm: 9 })],
    )).toEqual({ updatedAt: '2026-02-02T00:00:00.000Z' });
  });
});
