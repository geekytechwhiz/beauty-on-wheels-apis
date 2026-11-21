import { isPlatformAdminRole } from '@api-hub/authentication-core';
import { ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';
import { ServiceDiscoveryEntity, ServiceDiscoveryQuery, ServiceDiscoveryResult } from '../../types/service-discovery.types';
import { DiscoveryService } from '../../types/api-types';

/**
 * Catalog writes are restricted to platform administrators (ROOT / ADMIN).
 *
 * Identity and authorization stay in identity-v1-service and authorizer-service.
 * This helper only reads the authorizer roles those services already attach.
 * Permission identifiers are not consulted.
 */
export function isCatalogAdmin(request: LambdaRequest): boolean {
  return isPlatformAdminRole(access(request).roles);
}

export function assertCatalogAdmin(request: LambdaRequest): void {
  // const caller = access(request);
  // assertAuthenticated(caller);
  // if (!isPlatformAdminRole(caller.roles)) {
  //   throw new ForbiddenError('Catalog administrator access is required');
  // }
}

/**
 * Offering approval is an admin decision. ROOT or ADMIN only.
 */
export function assertOfferingApprovalAdmin(request: LambdaRequest): void {
  const caller = access(request);
  assertAuthenticated(caller);
  if (!isPlatformAdminRole(caller.roles)) {
    throw new ForbiddenError('Administrator access is required to approve offerings');
  }
}

function values(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim()).map((item) => item.trim());
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

function access(request: LambdaRequest): { authenticated: boolean; roles: string[] } {
  const auth = request.context.authContext;
  const source = auth && (auth.identityId || auth.userId || values(auth.roles).length)
    ? auth
    : request.context.userContext;
  const roles = values(source?.roles);
  return {
    authenticated: Boolean(source?.identityId || source?.userId || roles.length),
    roles,
  };
}

function assertAuthenticated(caller: { authenticated: boolean }): void {
  if (!caller.authenticated) throw new UnauthorizedError('Unauthorized');
}

export function approvalActor(request: LambdaRequest): string {
  const candidates = [
    request.context.userContext?.userId,
    request.context.authContext?.identityId,
    request.context.userContext?.identityId,
  ];
  const actor = candidates.find((value) => typeof value === 'string' && value.trim() !== '');
  return actor?.trim() ?? 'authorizer';
}

export function normalizeSearch(value?: string): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function calculateRelevance(
  entity: ServiceDiscoveryEntity,
  terms: string[],
): number {
  if (!terms.length) return 0;

  const name = normalizeSearch(entity.name);
  const text = normalizeSearch(entity.searchText);
  const phrase = terms.join(' ');

  if (name === phrase) return 100;
  if (name.startsWith(phrase)) return 80;
  if (name.includes(phrase)) return 60;

  if (terms.every((term) => name.includes(term))) {
    return 40;
  }

  if (terms.every((term) => text.includes(term))) {
    return 20;
  }

  return 0;
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;

  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function discoveryId(item: ServiceDiscoveryEntity): string {
  return [item.vendorId, item.branchId, item.serviceId].join('#');
}

export function compareDiscoveryResults(
  a: ServiceDiscoveryResult,
  b: ServiceDiscoveryResult,
  sortBy: ServiceDiscoveryQuery['sortBy'],
): number {
  let result = 0;

  switch (sortBy) {
    case 'DISTANCE_ASC':
      result = (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
      break;

    case 'PRICE_ASC':
      result = a.displayPrice - b.displayPrice;
      break;

    case 'PRICE_DESC':
      result = b.displayPrice - a.displayPrice;
      break;

    case 'RATING_DESC':
      result = (b.rating ?? 0) - (a.rating ?? 0);
      if (result === 0) {
        result = (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
      }
      break;

    case 'RELEVANCE':
    default:
      result = b.relevanceScore - a.relevanceScore;
      break;
  }

  if (result !== 0) return result;

  // Stable secondary ordering.
  if (sortBy !== 'RELEVANCE') {
    result = b.relevanceScore - a.relevanceScore;
    if (result !== 0) return result;
  }

  return discoveryId(a).localeCompare(discoveryId(b));
}

interface DiscoveryCursor {
  fingerprint: string;
  lastId: string;
}

export function encodeDiscoveryCursor(cursor: DiscoveryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeDiscoveryCursor(
  token?: string,
): DiscoveryCursor | undefined {
  if (!token) return undefined;

  try {
    const cursor = JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8'),
    ) as DiscoveryCursor;

    if (
      typeof cursor.fingerprint !== 'string' ||
      typeof cursor.lastId !== 'string'
    ) {
      throw new Error('Malformed cursor');
    }

    return cursor;
  } catch {
    throw new Error('Invalid discovery cursor');
  }
}



export function mapDiscoveryEntityToResponse(
  entity: ServiceDiscoveryResult,
): DiscoveryService {
  return {
    serviceId: entity.serviceId,
    vendorId: entity.vendorId,
    branchId: entity.branchId,
    categoryId: entity.categoryId,

    name: entity.name,
    description: entity.description,

    vehicleTypes: entity.vehicleTypes,

    displayPrice: entity.displayPrice,
    currency: entity.currency,

    distanceKm:
      entity.distanceKm !== undefined
        ? Number(entity.distanceKm.toFixed(2))
        : undefined,

    rating: entity.rating,
    reviewCount: entity.reviewCount,
    durationMinutes: entity.durationMinutes,
  };
}
