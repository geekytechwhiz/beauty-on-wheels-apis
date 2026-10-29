import { createHash } from 'node:crypto';

import { ValidationError } from '@api-hub/utils';

import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';
import { ServiceDiscoveryEntity } from '../types/service-discovery.types';
import { OfferingCommunityEntity } from '../utils/types/catalog-domain.types';
import {
  getOfferingCommunitiesRepository,
  OfferingCommunitiesRepository,
} from '../repositories/offering-communities.repository';
import { getServicesRepository, ServicesRepository } from '../repositories/services.repository';
import { queryFingerprint } from './cursor';
import { FILTER_OPERATOR, FilterClause, ParsedOfferingsQuery } from './types';

export interface CommunityIndexPage {
  items: OfferingCommunityEntity[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface CommunityOfferingSource {
  queryActivePage(input: {
    communityId: string;
    categoryId?: string;
    limit: number;
    exclusiveStartKey?: Record<string, unknown>;
  }): Promise<CommunityIndexPage>;
  listDiscoveryRows(serviceId: string): Promise<ServiceDiscoveryEntity[]>;
}

export class CatalogCommunityOfferingSource implements CommunityOfferingSource {
  constructor(
    private readonly communities: OfferingCommunitiesRepository = getOfferingCommunitiesRepository(),
    private readonly services: ServicesRepository = getServicesRepository(),
  ) {}

  queryActivePage(input: {
    communityId: string;
    categoryId?: string;
    limit: number;
    exclusiveStartKey?: Record<string, unknown>;
  }): Promise<CommunityIndexPage> {
    return this.communities.queryActivePage(input);
  }

  async listDiscoveryRows(serviceId: string): Promise<ServiceDiscoveryEntity[]> {
    const pointers = await this.services.listDiscoveryPointers(serviceId);
    const rows = await Promise.all(pointers.map((pointer) =>
      this.services.getDiscoveryItem(pointer.globalPk, pointer.globalSk)));
    return rows.filter((row): row is ServiceDiscoveryEntity => row?.entityType === 'SERVICE_DISCOVERY');
  }
}

interface CommunityOfferingsCursor {
  version: 2;
  fingerprint: string;
  key: Record<string, unknown>;
}

export function communityQueryFingerprint(
  query: ParsedOfferingsQuery,
  communityId: string,
): string {
  return createHash('sha256')
    .update(`${queryFingerprint(query)}|${communityId}`)
    .digest('hex');
}

export function encodeCommunityCursor(
  query: ParsedOfferingsQuery,
  communityId: string,
  key: Record<string, unknown>,
): string {
  const cursor: CommunityOfferingsCursor = {
    version: 2,
    fingerprint: communityQueryFingerprint(query, communityId),
    key,
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCommunityCursor(
  token: string | undefined,
  query: ParsedOfferingsQuery,
  communityId: string,
): Record<string, unknown> | undefined {
  if (!token) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new ValidationError('Invalid offerings cursor');
  }
  if (!isCommunityCursor(parsed)) {
    throw new ValidationError('Invalid offerings cursor');
  }
  if (parsed.fingerprint !== communityQueryFingerprint(query, communityId)) {
    throw new ValidationError('Cursor does not match filters');
  }
  return parsed.key;
}

export function categoryIdFromClauses(clauses: readonly FilterClause[]): string | undefined {
  const clause = clauses.find((item) =>
    item.field === 'categoryId' && item.operator === FILTER_OPERATOR.EQ && typeof item.value === 'string');
  return typeof clause?.value === 'string' ? clause.value : undefined;
}

/**
 * One discovery row per offering for community marketplace listing.
 * Prefer an operational branch when one exists (one-time booking compatibility).
 * Community-based package offerings without branch coverage stay eligible —
 * missing branch data alone must not hide a valid community offering.
 */
export function selectDiscoveryBranch(
  rows: readonly ServiceDiscoveryEntity[],
  clauses: readonly FilterClause[],
): ServiceDiscoveryEntity | undefined {
  const approved = rows.filter((row) =>
    row.entityType === 'SERVICE_DISCOVERY'
    && row.active === true
    && row.vendorApproved === true);
  
  return [...approved].sort((left, right) =>
    (left.branchId || '').localeCompare(right.branchId || ''),
  )[0];
}

export function communityIndexKey(communityId: string, categoryId: string, serviceId: string): {
  GSI3PK: string;
  GSI3SK: string;
} {
  return {
    GSI3PK: CatalogKeyBuilder.communityGsi3Pk(communityId),
    GSI3SK: CatalogKeyBuilder.communityGsi3Sk(categoryId, serviceId),
  };
}

function branchValues(clause: FilterClause): Set<string> {
  if (typeof clause.value === 'string') {
    return new Set([clause.value]);
  }
  if (Array.isArray(clause.value)) {
    return new Set(clause.value.filter((value): value is string => typeof value === 'string'));
  }
  return new Set();
}

function isCommunityCursor(value: unknown): value is CommunityOfferingsCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const cursor = value as Partial<CommunityOfferingsCursor>;
  return cursor.version === 2
    && typeof cursor.fingerprint === 'string'
    && Boolean(cursor.key)
    && typeof cursor.key === 'object'
    && !Array.isArray(cursor.key);
}
