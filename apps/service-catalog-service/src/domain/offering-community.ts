import { ValidationError } from '@api-hub/utils';

import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';
import {
  OFFERING_COMMUNITY_APPROVAL,
  OFFERING_COMMUNITY_STATUS,
  OfferingCommunityApprovalStatus,
  OfferingCommunityEntity,
  OfferingCommunityStatus,
  ServiceCreateIdempotencyEntity,
  ServiceEntity,
  ServiceLookupEntity,
  ServiceVehicleEntity,
} from '../utils/types/catalog-domain.types';

export const CATALOG_GSI3_INDEX = 'GSI3';
export const MAX_OFFERING_COMMUNITIES = 25;
export const MAX_TRANSACT_ITEMS = 100;
export const ABSENT_CONDITION = 'attribute_not_exists(PK) AND attribute_not_exists(SK)';
export const VERSION_CONDITION = 'attribute_exists(PK) AND version = :expected';
export const EXISTS_CONDITION = 'attribute_exists(PK) AND attribute_exists(SK)';

const COMMUNITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,80}$/;

export interface CatalogPut {
  item: Record<string, unknown>;
  condition: 'absent' | 'version' | 'exists' | 'legacyApproval';
  expectedVersion?: number;
}

export interface CatalogDelete {
  kind: 'delete';
  PK: string;
  SK: string;
}

export type CatalogWrite = CatalogPut | CatalogDelete;

export interface OfferingCommunityView {
  communityId: string;
  approvalStatus: OfferingCommunityApprovalStatus;
  status: OfferingCommunityStatus;
  version: number;
  approvalUpdatedAt?: string;
  approvalUpdatedBy?: string;
}

export function communityOfferingEnforcementEnabled(): boolean {
  return process.env.COMMUNITY_OFFERING_ENFORCEMENT === 'true';
}

/**
 * Only the exact value `true` enables automatic approval.
 * Missing, empty, and any other string stay on the admin-approval path.
 */
export function communityOfferingAutoApproveEnabled(): boolean {
  return process.env.COMMUNITY_OFFERING_AUTO_APPROVE === 'true';
}

export function initialApprovalStatus(): OfferingCommunityApprovalStatus {
  return communityOfferingAutoApproveEnabled()
    ? OFFERING_COMMUNITY_APPROVAL.APPROVED
    : OFFERING_COMMUNITY_APPROVAL.PENDING;
}

export function effectiveApprovalStatus(
  mapping: Pick<OfferingCommunityEntity, 'approvalStatus'>,
): OfferingCommunityApprovalStatus {
  if (
    mapping.approvalStatus === OFFERING_COMMUNITY_APPROVAL.APPROVED
    || mapping.approvalStatus === OFFERING_COMMUNITY_APPROVAL.PENDING
    || mapping.approvalStatus === OFFERING_COMMUNITY_APPROVAL.REJECTED
  ) {
    return mapping.approvalStatus;
  }
  return OFFERING_COMMUNITY_APPROVAL.PENDING;
}

export function normalizeCommunityIds(values: readonly string[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const communityId = value.trim();
    if (!COMMUNITY_ID_PATTERN.test(communityId)) {
      throw new ValidationError('Invalid communityId');
    }
    if (seen.has(communityId)) {
      throw new ValidationError(`Duplicate communityId: ${communityId}`);
    }
    seen.add(communityId);
    ids.push(communityId);
  }
  if (ids.length > MAX_OFFERING_COMMUNITIES) {
    throw new ValidationError(
      `A service can be offered in at most ${MAX_OFFERING_COMMUNITIES} communities`,
    );
  }
  return ids;
}

export function assertIdempotencyKey(value: string): string {
  const key = value.trim();
  if (!IDEMPOTENCY_PATTERN.test(key)) {
    throw new ValidationError('Idempotency-Key header is required');
  }
  return key;
}

export function readOptionalIdempotencyKey(
  headers: Record<string, unknown> | undefined,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'idempotency-key');
  if (!entry || entry[1] === undefined || entry[1] === '') {
    return undefined;
  }
  if (typeof entry[1] !== 'string') {
    throw new ValidationError('Idempotency-Key header is required');
  }
  return assertIdempotencyKey(entry[1]);
}

export function assertActiveDirectoryCommunities(
  communityIds: readonly string[],
  activeIds: readonly string[],
): void {
  const active = new Set(activeIds);
  const missing = communityIds.find((communityId) => !active.has(communityId));
  if (missing) {
    throw new ValidationError(`Community is not an active platform community: ${missing}`);
  }
}

export function communityIsIndexed(
  mapping: Pick<OfferingCommunityEntity, 'status' | 'serviceActive' | 'approvalStatus'>,
): boolean {
  return mapping.status === OFFERING_COMMUNITY_STATUS.ACTIVE
    && mapping.serviceActive === true
    && effectiveApprovalStatus(mapping) === OFFERING_COMMUNITY_APPROVAL.APPROVED;
}

export function withCommunityIndex(mapping: OfferingCommunityEntity): OfferingCommunityEntity {
  const { GSI3PK: _pk, GSI3SK: _sk, ...rest } = mapping;
  if (!communityIsIndexed(mapping)) {
    return rest;
  }
  return {
    ...rest,
    GSI3PK: CatalogKeyBuilder.communityGsi3Pk(mapping.communityId),
    GSI3SK: CatalogKeyBuilder.communityGsi3Sk(mapping.categoryId, mapping.serviceId),
  };
}

export function buildOfferingCommunity(input: {
  service: Pick<ServiceEntity, 'vendorId' | 'categoryId' | 'serviceId' | 'active'>;
  communityId: string;
  status: OfferingCommunityStatus;
  approvalStatus: OfferingCommunityApprovalStatus;
  approvalUpdatedBy?: string;
  version?: number;
  now: string;
  createdAt?: string;
}): OfferingCommunityEntity {
  const approved = input.approvalStatus === OFFERING_COMMUNITY_APPROVAL.APPROVED;
  return withCommunityIndex({
    PK: CatalogKeyBuilder.serviceLookupPk(input.service.serviceId),
    SK: CatalogKeyBuilder.offeringCommunitySk(input.communityId),
    entityType: 'OfferingCommunity',
    vendorId: input.service.vendorId,
    categoryId: input.service.categoryId,
    serviceId: input.service.serviceId,
    communityId: input.communityId,
    status: input.status,
    approvalStatus: input.approvalStatus,
    ...(approved
      ? {
          approvalUpdatedAt: input.now,
          approvalUpdatedBy: input.approvalUpdatedBy ?? 'system',
        }
      : {}),
    serviceActive: input.service.active,
    version: input.version ?? 1,
    createdAt: input.createdAt ?? input.now,
    updatedAt: input.now,
  });
}

export function buildServiceIdempotency(input: {
  vendorId: string;
  serviceId: string;
  categoryId: string;
  idempotencyKey: string;
  now: string;
}): ServiceCreateIdempotencyEntity {
  return {
    PK: CatalogKeyBuilder.vendorPk(input.vendorId),
    SK: CatalogKeyBuilder.serviceIdempotencySk(input.idempotencyKey),
    entityType: 'ServiceCreateIdempotency',
    vendorId: input.vendorId,
    serviceId: input.serviceId,
    categoryId: input.categoryId,
    idempotencyKey: input.idempotencyKey,
    createdAt: input.now,
  };
}

export function buildServiceCreatePuts(input: {
  service: ServiceEntity;
  lookup: ServiceLookupEntity;
  vehicles: readonly ServiceVehicleEntity[];
  mappings: readonly OfferingCommunityEntity[];
  idempotency?: ServiceCreateIdempotencyEntity;
}): CatalogPut[] {
  const puts: CatalogPut[] = [
    ...(input.idempotency ? [{ item: input.idempotency as unknown as Record<string, unknown>, condition: 'absent' as const }] : []),
    { item: input.service as unknown as Record<string, unknown>, condition: 'absent' },
    { item: input.lookup as unknown as Record<string, unknown>, condition: 'absent' },
    ...input.vehicles.map((vehicle) => ({
      item: vehicle as unknown as Record<string, unknown>,
      condition: 'absent' as const,
    })),
    ...input.mappings.map((mapping) => ({
      item: withCommunityIndex(mapping) as unknown as Record<string, unknown>,
      condition: 'absent' as const,
    })),
  ];
  assertTransactLimit(puts.length);
  return puts;
}

export function versionedPut(item: OfferingCommunityEntity): CatalogPut {
  return {
    item: withCommunityIndex(item) as unknown as Record<string, unknown>,
    condition: 'version',
    expectedVersion: item.version - 1,
  };
}

export function assertTransactLimit(count: number): void {
  if (count > MAX_TRANSACT_ITEMS) {
    throw new ValidationError(
      `Service create exceeds the DynamoDB transaction limit of ${MAX_TRANSACT_ITEMS} items`,
    );
  }
}

export function toTransactPuts(
  tableName: string,
  writes: readonly CatalogWrite[],
): Array<Record<string, unknown>> {
  assertTransactLimit(writes.length);
  return writes.map((write) => {
    if ('kind' in write) {
      return {
        Delete: {
          TableName: tableName,
          Key: { PK: write.PK, SK: write.SK },
          ConditionExpression: EXISTS_CONDITION,
        },
      };
    }
    const condition = write.condition === 'absent'
      ? ABSENT_CONDITION
      : write.condition === 'version'
        ? VERSION_CONDITION
        : write.condition === 'legacyApproval'
          ? 'attribute_exists(PK) AND attribute_not_exists(approvalStatus) AND version = :expected'
          : EXISTS_CONDITION;
    return {
      Put: {
        TableName: tableName,
        Item: write.item,
        ConditionExpression: condition,
        ...(write.condition === 'version' || write.condition === 'legacyApproval'
          ? { ExpressionAttributeValues: { ':expected': write.expectedVersion } }
          : {}),
      },
    };
  });
}

export function toCommunityView(mapping: OfferingCommunityEntity): OfferingCommunityView {
  return {
    communityId: mapping.communityId,
    approvalStatus: effectiveApprovalStatus(mapping),
    status: mapping.status,
    version: mapping.version,
    ...(mapping.approvalUpdatedAt ? { approvalUpdatedAt: mapping.approvalUpdatedAt } : {}),
    ...(mapping.approvalUpdatedBy ? { approvalUpdatedBy: mapping.approvalUpdatedBy } : {}),
  };
}

export function nextMappingStatus(
  current: OfferingCommunityEntity,
  status: OfferingCommunityStatus,
  now: string,
): OfferingCommunityEntity {
  return withCommunityIndex({
    ...current,
    status,
    version: current.version + 1,
    updatedAt: now,
  });
}

export function nextServiceActive(
  current: OfferingCommunityEntity,
  serviceActive: boolean,
  now: string,
): OfferingCommunityEntity {
  return withCommunityIndex({
    ...current,
    serviceActive,
    version: current.version + 1,
    updatedAt: now,
  });
}

export function nextApproval(
  current: OfferingCommunityEntity,
  approvalStatus: OfferingCommunityApprovalStatus,
  actor: string,
  now: string,
): OfferingCommunityEntity {
  return withCommunityIndex({
    ...current,
    approvalStatus,
    approvalUpdatedBy: actor,
    approvalUpdatedAt: now,
    version: current.version + 1,
    updatedAt: now,
  });
}

/**
 * Fills a missing approval decision with pending and leaves version and
 * operational status untouched. Approved and rejected rows must not use this.
 */
export function legacyPendingMapping(
  current: OfferingCommunityEntity,
  now: string,
): OfferingCommunityEntity {
  return withCommunityIndex({
    ...current,
    approvalStatus: OFFERING_COMMUNITY_APPROVAL.PENDING,
    updatedAt: now,
  });
}

export function legacyApprovalPut(item: OfferingCommunityEntity): CatalogPut {
  return {
    item: withCommunityIndex(item) as unknown as Record<string, unknown>,
    condition: 'legacyApproval',
    expectedVersion: item.version,
  };
}

/**
 * In-memory TransactWrite used by tests. A conditional failure leaves the
 * table unchanged, matching DynamoDB.
 */
export function applyConditionalWrites(
  table: Map<string, Record<string, unknown>>,
  writes: readonly CatalogWrite[],
): void {
  assertTransactLimit(writes.length);
  const next = new Map(table);
  for (const write of writes) {
    if ('kind' in write) {
      const key = itemKey(write.PK, write.SK);
      if (!next.has(key)) {
        throw new Error('ConditionalCheckFailed');
      }
      next.delete(key);
      continue;
    }
    const pk = String(write.item.PK);
    const sk = String(write.item.SK);
    const key = itemKey(pk, sk);
    const existing = next.get(key);
    if (write.condition === 'absent' && existing) {
      throw new Error('ConditionalCheckFailed');
    }
    if (write.condition !== 'absent' && !existing) {
      throw new Error('ConditionalCheckFailed');
    }
    if (
      (write.condition === 'version' || write.condition === 'legacyApproval')
      && Number(existing?.version) !== write.expectedVersion
    ) {
      throw new Error('ConditionalCheckFailed');
    }
    if (write.condition === 'legacyApproval' && existing?.approvalStatus !== undefined) {
      throw new Error('ConditionalCheckFailed');
    }
    next.set(key, { ...write.item });
  }
  table.clear();
  for (const [key, value] of next) {
    table.set(key, value);
  }
}

export function itemKey(pk: string, sk: string): string {
  return `${pk}|${sk}`;
}

export function isOfferingCommunity(item: Record<string, unknown> | undefined): item is OfferingCommunityEntity & Record<string, unknown> {
  return item?.entityType === 'OfferingCommunity';
}
