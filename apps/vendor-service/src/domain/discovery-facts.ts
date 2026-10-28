import { CapabilitiesMapper } from '../mappers/capabilities.mapper';
import {
  ServiceAreaDdbItem,
  VendorBranchDdbItem,
  VendorCapabilitiesDdbItem,
  VendorDdbItem,
} from '../types/repository.types';
import { isAcceptingWork } from './lifecycle';

export interface DiscoveryBranchFacts {
  branchId: string;
  operational: boolean;
  latitude?: number;
  longitude?: number;
  serviceRadiusKm?: number;
  updatedAt: string;
}

export interface DiscoveryServicePriceFacts {
  serviceId: string;
  enabled: boolean;
  priceOverride?: number;
  updatedAt: string;
}

/**
 * Facts catalog discovery is allowed to copy.
 * Contact details, documents, and bank data stay out.
 */
export interface DiscoveryFacts {
  vendorId: string;
  status: string;
  reviewedAt: string;
  acceptingWork: boolean;
  branches: DiscoveryBranchFacts[];
  services: DiscoveryServicePriceFacts[];
  /** Communities the vendor may offer services in. Catalog treats a missing list as unreadable. */
  communityIds: string[];
}

export function buildDiscoveryFacts(input: {
  vendor: VendorDdbItem;
  branches: readonly VendorBranchDdbItem[];
  areas: readonly ServiceAreaDdbItem[];
  capabilities: VendorCapabilitiesDdbItem | null;
}): DiscoveryFacts {
  const acceptingWork = isAcceptingWork(input.vendor.operationalStatus);
  const reviewedAt = input.vendor.latestReview?.reviewedAt ?? input.vendor.updatedAt;
  const pricingUpdatedAt = input.capabilities?.updatedAt ?? input.vendor.updatedAt;

  return {
    vendorId: input.vendor.vendorId,
    status: input.vendor.status,
    reviewedAt,
    acceptingWork,
    communityIds: uniqueCommunityIds(input.vendor.communityIds),
    branches: input.branches.map((branch) =>
      branchFacts(branch, input.areas, acceptingWork),
    ),
    services: input.capabilities
      ? CapabilitiesMapper.servicesFromItem(input.capabilities).map((entry) => ({
          serviceId: entry.serviceId,
          enabled: entry.enabled,
          ...(typeof entry.priceOverride === 'number' ? { priceOverride: entry.priceOverride } : {}),
          updatedAt: pricingUpdatedAt,
        }))
      : [],
  };
}

function uniqueCommunityIds(values: readonly string[] | undefined): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    if (typeof value !== 'string') {
      continue;
    }
    const communityId = value.trim();
    if (!communityId || seen.has(communityId)) {
      continue;
    }
    seen.add(communityId);
    ids.push(communityId);
  }
  return ids;
}

function branchFacts(
  branch: VendorBranchDdbItem,
  areas: readonly ServiceAreaDdbItem[],
  acceptingWork: boolean,
): DiscoveryBranchFacts {
  const latitude = coordinate(branch.geoLocation?.latitude, -90, 90);
  const longitude = coordinate(branch.geoLocation?.longitude, -180, 180);
  const coverage = coverageForBranch(
    { latitude, longitude, updatedAt: branch.updatedAt },
    areas,
  );

  return {
    branchId: branch.branchId,
    operational: acceptingWork,
    ...(latitude === undefined ? {} : { latitude }),
    ...(longitude === undefined ? {} : { longitude }),
    ...(coverage.serviceRadiusKm === undefined ? {} : { serviceRadiusKm: coverage.serviceRadiusKm }),
    updatedAt: coverage.updatedAt,
  };
}

/**
 * Service areas belong to the vendor, not to one branch.
 * One active area applies to every branch. Several areas use the area
 * whose center is nearest the branch. Several areas and no branch
 * coordinates are left unset.
 */
export function coverageForBranch(
  branch: { latitude?: number; longitude?: number; updatedAt: string },
  areas: readonly ServiceAreaDdbItem[],
): { serviceRadiusKm?: number; updatedAt: string } {
  const active = areas.filter((area) => area.active && positiveRadius(area.radiusKm));
  if (active.length === 0) {
    return { updatedAt: branch.updatedAt };
  }
  if (active.length === 1) {
    return {
      serviceRadiusKm: active[0].radiusKm,
      updatedAt: later(branch.updatedAt, active[0].updatedAt),
    };
  }

  const located = active.filter((area) =>
    coordinate(area.center?.latitude, -90, 90) !== undefined
    && coordinate(area.center?.longitude, -180, 180) !== undefined,
  );
  if (
    located.length === 0
    || branch.latitude === undefined
    || branch.longitude === undefined
  ) {
    return { updatedAt: branch.updatedAt };
  }

  let nearest = located[0];
  let nearestKm = haversineKm(
    branch.latitude,
    branch.longitude,
    nearest.center!.latitude,
    nearest.center!.longitude,
  );
  for (const area of located.slice(1)) {
    const distanceKm = haversineKm(
      branch.latitude,
      branch.longitude,
      area.center!.latitude,
      area.center!.longitude,
    );
    if (distanceKm < nearestKm) {
      nearest = area;
      nearestKm = distanceKm;
    }
  }
  return {
    serviceRadiusKm: nearest.radiusKm,
    updatedAt: later(branch.updatedAt, nearest.updatedAt),
  };
}

function positiveRadius(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function coordinate(value: number | undefined, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return undefined;
  }
  return value;
}

function later(left: string, right: string): string {
  return left >= right ? left : right;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
