import type {
  AuditRecord,
  MetadataTypeInput,
  MetadataTypeListItem,
  MetadataTypeRecord,
  MetadataValueInput,
  MetadataValueRecord,
  Status,
  ValueSearchFilter,
} from '../models/types';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  assertMetadataTypeActiveForValueMutation,
  assertPatchStatusAllowedForInactiveRecord,
  assertPostUpsertAllowedForLatestStatus,
} from '../domain/errors';
import { QUESTION_TYPE_METADATA_CODE, STATUS } from '../constants';
import { isAttributeSchemaCompatibleExtension } from '../domain/diff';
import { attributeSchemaFieldMapForCompatibility } from '../validators/attribute-schema.validator';
import {
  validateMetadataTypeInput,
  validateMetadataValueInput,
  validateValueSearchFilter,
} from '../validators/validate-inputs';
import {
  assertMetadataTypeCode,
  assertEnumTokenArray,
  assertMetadataValueCode,
} from '../validators/code-patterns';
import { matchesSearchFilter, sortValuesForSearch } from '../domain/search-filter';
import { recordMatchesLifecycleStatus } from '../domain/lifecycle-filter';

import type { RelationType } from '../models/relation-types';
import { assertGovernedRelationTypeForTypes } from '../validators/relation';

import type { ListMetadataInput } from '../types/list-metadata-input';
import type { ListTypesFilter, MetadataTypeListEntry } from '../repositories/metadata-registry.repository.interface';
import { decodePaginationKey, encodePaginationKey } from '../lib/pagination-key';

import {
  flattenMetadataValueForApi,
  mergeMetadataTypeForUpdate,
  normalizeMetadataTypeInput,
  normalizeMetadataValueInput,
  type MetadataValueApiModel,
} from '../mappers/metadata-request.mapper';
import {
  getMetadataRepository,
  getMetadataRegistryDynamoContext,
  getRelationRepository,
} from '../dynamodb/dynamodb.client';
import {
  assertRelationshipTargetsReferenceValidValues,
  inactivateAllRelationsInvolvingMetadataValue,
  resolveRelationshipsForApi,
  syncMetadataValueRelationships,
  validateValueRelationshipsPayload,
} from './metadata-value-relation.service';
import type { RegistryPostMetadataInput } from './metadata.service.types';

export type { RegistryPostMetadataInput, RegistryPostMetadataPublishInput, RegistryPostMetadataCancelInput } from './metadata.service.types';

function actorFromContext(userId?: string): string | undefined {
  return userId;
}

async function assertMetadataTypeRelationTargetExists(input: MetadataTypeInput): Promise<void> {
  if (!input.supportsRelations || !input.targetMetadataTypeCode?.trim()) {
    return;
  }
  const code = input.targetMetadataTypeCode.trim();
  const repo = await getMetadataRepository();
  const t = await repo.getMetadataType(code);
  if (!t) {
    throw new NotFoundError(`targetMetadataTypeCode not found: ${code}`);
  }
}

async function enrichMetadataValueForApi(
  record: MetadataValueRecord,
  opts?: { includeInactiveRelations?: boolean },
): Promise<MetadataValueApiModel> {
  const meta = await getMetadataRepository();
  const rel = await getRelationRepository();
  const flat = flattenMetadataValueForApi(record);
  const typeRecord = await meta.getMetadataType(record.metadataTypeCode);
  if (!typeRecord?.supportsRelations) {
    return flat;
  }
  const relationships = await resolveRelationshipsForApi(meta, rel, typeRecord, record, opts);
  return { ...flat, relationships };
}

async function enrichMetadataValuesForApi(records: MetadataValueRecord[]): Promise<MetadataValueApiModel[]> {
  const meta = await getMetadataRepository();
  const rel = await getRelationRepository();
  const typeCache = new Map<string, MetadataTypeRecord | null>();
  async function cachedType(code: string): Promise<MetadataTypeRecord | null> {
    const hit = typeCache.get(code);
    if (hit !== undefined) {
      return hit;
    }
    const t = await meta.getMetadataType(code);
    typeCache.set(code, t);
    return t;
  }
  return Promise.all(
    records.map(async (r) => {
      const flat = flattenMetadataValueForApi(r);
      const t = await cachedType(r.metadataTypeCode);
      if (!t?.supportsRelations) {
        return flat;
      }
      const relationships = await resolveRelationshipsForApi(meta, rel, t, r);
      return { ...flat, relationships };
    }),
  );
}

/**
 * Active QuestionType value codes when the catalog type exists and is ACTIVE; otherwise `undefined`
 * (skip enum enforcement so greenfield envs without a seeded QuestionType type keep working).
 */
async function resolveActiveQuestionTypeValueCodes(): Promise<string[] | undefined> {
  const repo = await getMetadataRepository();
  const qtType = await repo.getMetadataType(QUESTION_TYPE_METADATA_CODE);
  if (!qtType || qtType.status !== STATUS.ACTIVE) {
    return undefined;
  }
  const rows = await repo.listMetadataValues(QUESTION_TYPE_METADATA_CODE, [STATUS.ACTIVE]);
  if (rows.length === 0) {
    throw new ValidationError('QuestionType metadata has no active values; cannot validate questionType', [
      { field: 'attributes.questionType', message: 'Catalog empty' },
    ]);
  }
  return rows.map((v) => v.valueCode);
}

function registryListPaginationRequested(input: ListMetadataInput): boolean {
  return (
    input.limit !== undefined ||
    (input.nextPaginationKey !== undefined && String(input.nextPaginationKey).trim() !== '')
  );
}

function hasApplicabilityListFilters(input: ListMetadataInput): boolean {
  return Boolean(
    (input.applicableModules?.length ?? 0) +
      (input.applicableCategories?.length ?? 0) +
      (input.applicableConditions?.length ?? 0) +
      (input.applicableCountries?.length ?? 0) +
      (input.applicableLanguages?.length ?? 0),
  );
}

function metadataTypeListItemValueCount(
  lifecycleStatuses: Status[],
  activeValueCount: number,
  inactiveValueCount: number,
): number {
  const hasActive = lifecycleStatuses.includes(STATUS.ACTIVE);
  const hasInactive = lifecycleStatuses.includes(STATUS.INACTIVE);
  if (hasActive && hasInactive) {
    return activeValueCount + inactiveValueCount;
  }
  if (hasInactive) {
    return inactiveValueCount;
  }
  return activeValueCount;
}

export async function getType(metadataTypeCode: string): Promise<MetadataTypeRecord | null> {
  assertMetadataTypeCode(metadataTypeCode);
  return (await getMetadataRepository()).getMetadataType(metadataTypeCode);
}

export async function listTypes(filters: {
  statuses?: Status[];
  module?: string;
  valueDataType?: string;
}): Promise<MetadataTypeRecord[]> {
  const entries = await (await getMetadataRepository()).listMetadataTypes(filters);
  return entries.map((e) => e.type);
}

/**
 * GET type by code with Active/Inactive/All semantics (Lambda handler delegates here).
 */
export async function resolveMetadataTypeGet(
  metadataTypeCode: string,
  lifecycleStatuses: Status[],
): Promise<MetadataTypeRecord> {
  const t = await getType(metadataTypeCode);
  if (!t) {
    throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
  }
  if (!recordMatchesLifecycleStatus(t.status, lifecycleStatuses)) {
    throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
  }
  return t;
}

/** POST /metadata-types — create if missing, else update. */
export async function upsertMetadataType(body: MetadataTypeInput, userId?: string): Promise<MetadataTypeRecord> {
  const repo = await getMetadataRepository();
  const actor = actorFromContext(userId);
  assertMetadataTypeCode(body.metadataTypeCode);
  const existing = await repo.getMetadataType(body.metadataTypeCode);
  if (!existing) {
    validateMetadataTypeInput(body, false);
    await assertMetadataTypeRelationTargetExists(body);
    if (body.supportsRelations && body.relationType && body.targetMetadataTypeCode) {
      assertGovernedRelationTypeForTypes({
        relationType: body.relationType as RelationType,
        metadataTypeCode: body.metadataTypeCode,
        targetMetadataTypeCode: body.targetMetadataTypeCode,
      });
    }
    return repo.createMetadataType(body, actor);
  }
  const merged = mergeMetadataTypeForUpdate(existing, body);
  validateMetadataTypeInput(merged, true);
  await assertMetadataTypeRelationTargetExists(merged);
  if (merged.supportsRelations && merged.relationType && merged.targetMetadataTypeCode) {
    assertGovernedRelationTypeForTypes({
      relationType: merged.relationType as RelationType,
      metadataTypeCode: merged.metadataTypeCode,
      targetMetadataTypeCode: merged.targetMetadataTypeCode,
    });
  }
  assertPostUpsertAllowedForLatestStatus(existing.status, merged.status);
  const oldMap = attributeSchemaFieldMapForCompatibility(
    existing.attributeSchema as Record<string, unknown> | undefined,
  );
  const newMap = attributeSchemaFieldMapForCompatibility(merged.attributeSchema as Record<string, unknown> | undefined);
  if (!isAttributeSchemaCompatibleExtension(oldMap, newMap)) {
    throw new ValidationError('attributeSchema is not a compatible extension of the existing schema', [
      {
        field: 'attributeSchema',
        message: 'Cannot remove or change existing attribute definitions; only additive extensions are allowed',
      },
    ]);
  }
  return repo.updateMetadataType(merged, actor);
}

export async function patchTypeStatus(
  metadataTypeCode: string,
  status: Status,
  userId?: string,
): Promise<MetadataTypeRecord> {
  assertMetadataTypeCode(metadataTypeCode);
  const repo = await getMetadataRepository();
  const existing = await repo.getMetadataType(metadataTypeCode);
  if (!existing) {
    throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
  }
  assertPatchStatusAllowedForInactiveRecord(existing.status, status);
  return repo.patchMetadataTypeStatus(metadataTypeCode, status, actorFromContext(userId));
}

/**
 * POST /metadata-types/{code}/values — create or update value (each write appends a new version).
 * Pass `preloaded` when the caller has already loaded the current value (avoids an extra read).
 */
export async function upsertMetadataValue(
  metadataTypeCode: string,
  body: MetadataValueInput,
  userId?: string,
  preloaded?: MetadataValueRecord | null,
): Promise<MetadataValueRecord> {
  const repo = await getMetadataRepository();
  const actor = body.createdBy ?? actorFromContext(userId);
  assertMetadataTypeCode(metadataTypeCode);
  assertMetadataValueCode(body.valueCode);
  const existing =
    preloaded !== undefined ? preloaded : await repo.getMetadataValue(metadataTypeCode, body.valueCode);
  const type = await repo.getMetadataType(metadataTypeCode);
  if (!type) {
    throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
  }
  if (existing && existing.status === STATUS.DELETED) {
    throw new ConflictError(`Value ${body.valueCode} has been deleted`, 'VALUE_ALREADY_DELETED');
  }
  assertMetadataTypeActiveForValueMutation(type, metadataTypeCode);
  const allowedQuestionTypeCodes =
    metadataTypeCode === 'QuestionCode' ? await resolveActiveQuestionTypeValueCodes() : undefined;
  if (!existing) {
    validateMetadataValueInput(body, {
      metadataType: type,
      mode: 'create',
      mergedIsGlobal: body.isGlobal!,
      allowedQuestionTypeCodes,
    });
    return repo.createMetadataValue(metadataTypeCode, body, actor);
  }
  assertPostUpsertAllowedForLatestStatus(existing.status, body.status);
  const mergedIsGlobal = body.isGlobal ?? existing.isGlobal;
  validateMetadataValueInput(body, {
    metadataType: type,
    mode: 'update',
    mergedIsGlobal,
    expectedValueCode: existing.valueCode,
    allowedQuestionTypeCodes,
  });
  return repo.updateMetadataValue(metadataTypeCode, body, actor, existing);
}

export async function patchValueStatus(
  metadataTypeCode: string,
  valueCode: string,
  status: Status,
  userId?: string,
): Promise<MetadataValueRecord> {
  const repo = await getMetadataRepository();
  assertMetadataValueCode(valueCode);
  const existing = await repo.getMetadataValue(metadataTypeCode, valueCode);
  if (!existing) {
    throw new NotFoundError(`Value ${valueCode} not found`);
  }
  if (existing.status === STATUS.DELETED) {
    throw new ConflictError(`Value ${valueCode} has been deleted`, 'VALUE_ALREADY_DELETED');
  }
  assertPatchStatusAllowedForInactiveRecord(existing.status, status);
  assertMetadataTypeCode(metadataTypeCode);
  const type = await repo.getMetadataType(metadataTypeCode);
  if (!type) {
    throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
  }
  assertMetadataTypeActiveForValueMutation(type, metadataTypeCode);
  const actor = actorFromContext(userId);
  const record = await repo.patchMetadataValueStatus(metadataTypeCode, valueCode, status, actor);
  if (status === STATUS.INACTIVE) {
    const relRepo = await getRelationRepository();
    await inactivateAllRelationsInvolvingMetadataValue(repo, relRepo, metadataTypeCode, valueCode, actor);
  }
  return record;
}

export async function getValue(metadataTypeCode: string, valueCode: string): Promise<MetadataValueRecord | null> {
  assertMetadataValueCode(valueCode);
  return (await getMetadataRepository()).getMetadataValue(metadataTypeCode, valueCode);
}

/**
 * GET value by paths with Active/Inactive/All semantics and API flattening (Lambda handler delegates here).
 */
export async function resolveMetadataValueGetForApi(
  metadataTypeCode: string,
  valueCode: string,
  lifecycleStatuses: Status[],
): Promise<MetadataValueApiModel> {
  const v = await getValue(metadataTypeCode, valueCode);
  if (!v) {
    throw new NotFoundError(`Value ${valueCode} not found`);
  }
  if (!recordMatchesLifecycleStatus(v.status, lifecycleStatuses)) {
    throw new NotFoundError(`Value ${valueCode} not found`);
  }
  return enrichMetadataValueForApi(v);
}


export async function listValues(
  metadataTypeCode: string,
  lifecycleStatuses: Status[],
): Promise<MetadataValueRecord[]> {
  assertMetadataTypeCode(metadataTypeCode);
  return (await getMetadataRepository()).listMetadataValues(metadataTypeCode, lifecycleStatuses);
}

/**
 * Soft-delete latest metadata value (new immutable version, status DELETED). Types must be ACTIVE (same as other mutations).
 */
export async function deleteMetadataValue(
  metadataTypeCode: string,
  valueCode: string,
  opts: { reason?: string; userId?: string },
): Promise<MetadataValueRecord> {
  assertMetadataTypeCode(metadataTypeCode);
  assertMetadataValueCode(valueCode);
  const repo = await getMetadataRepository();
  const type = await repo.getMetadataType(metadataTypeCode);
  if (!type) {
    throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
  }
  assertMetadataTypeActiveForValueMutation(type, metadataTypeCode);
  const actor = actorFromContext(opts.userId);
  const record = await repo.softDeleteMetadataValue(metadataTypeCode, valueCode, {
    reason: opts.reason,
    actor,
  });
  const relRepo = await getRelationRepository();
  await inactivateAllRelationsInvolvingMetadataValue(repo, relRepo, metadataTypeCode, valueCode, actor);
  return record;
}

export async function listTypeAudit(metadataTypeCode: string): Promise<AuditRecord[]> {
  assertMetadataTypeCode(metadataTypeCode);
  return (await getMetadataRepository()).listTypeAudit(metadataTypeCode);
}

export async function listValueAudit(metadataTypeCode: string, valueCode: string): Promise<AuditRecord[]> {
  assertMetadataTypeCode(metadataTypeCode);
  assertMetadataValueCode(valueCode);
  return (await getMetadataRepository()).listValueAudit(metadataTypeCode, valueCode);
}

/** Repository search with filter validation; prefer this over calling the repository directly. */
export async function searchMetadataValues(
  metadataTypeCode: string,
  filter: ValueSearchFilter,
): Promise<MetadataValueRecord[]> {
  assertMetadataTypeCode(metadataTypeCode);
  validateValueSearchFilter(filter);
  return (await getMetadataRepository()).searchMetadataValues(metadataTypeCode, filter);
}

function mapTypeEntriesToListItems(
  entries: MetadataTypeListEntry[],
  lifecycleStatuses: Status[],
): MetadataTypeListItem[] {
  return entries.map((e) => ({
    ...e.type,
    metadataValueCount: metadataTypeListItemValueCount(
      lifecycleStatuses,
      e.activeValueCount,
      e.inactiveValueCount,
    ),
  }));
}

async function listMetadataTypesForRegistry(
  input: ListMetadataInput,
  paginated: boolean,
): Promise<{ items: MetadataTypeListItem[]; lastEvaluatedKey?: Record<string, unknown> }> {
  const { lifecycleStatuses } = input;

  const filter: ListTypesFilter = {
    module: input.module,
    valueDataType: input.valueDataType,
    statuses: lifecycleStatuses,
  };
  const repo = await getMetadataRepository();

  if (paginated) {
    const ctx = await getMetadataRegistryDynamoContext();
    const eks = input.nextPaginationKey
      ? decodePaginationKey(input.nextPaginationKey, ctx.pkAttr, ctx.skAttr)
      : undefined;
    const limit = input.limit ?? 50;
    const { entries, lastEvaluatedKey } = await repo.listMetadataTypesPaginated(filter, {
      limit,
      exclusiveStartKey: eks,
    });
    return { items: mapTypeEntriesToListItems(entries, lifecycleStatuses), lastEvaluatedKey };
  }

  const entries = await repo.listMetadataTypes(filter);
  return { items: mapTypeEntriesToListItems(entries, lifecycleStatuses) };
}

async function listMetadataValuesForRegistry(
  input: ListMetadataInput,
  paginated: boolean,
): Promise<{ items: MetadataValueApiModel[]; lastEvaluatedKey?: Record<string, unknown> }> {
  const { lifecycleStatuses } = input;

  const filter: ValueSearchFilter = {};

  if (input.applicableModules?.length) {
    assertEnumTokenArray(input.applicableModules, 'applicableModules');
    filter.module = input.applicableModules;
  }

  if (input.applicableCategories?.length) {
    assertEnumTokenArray(input.applicableCategories, 'applicableCategories');
    filter.category = input.applicableCategories;
  }

  if (input.applicableConditions?.length) {
    assertEnumTokenArray(input.applicableConditions, 'applicableConditions');
    filter.condition = input.applicableConditions;
  }

  if (input.applicableCountries?.length) {
    assertEnumTokenArray(input.applicableCountries, 'applicableCountries');
    filter.country = input.applicableCountries;
  }

  if (input.applicableLanguages?.length) {
    assertEnumTokenArray(input.applicableLanguages, 'applicableLanguages');
    filter.language = input.applicableLanguages;
  }

  const allowPaginatedValues = paginated && !hasApplicabilityListFilters(input);

  if (allowPaginatedValues) {
    const ctx = await getMetadataRegistryDynamoContext();
    const eks = input.nextPaginationKey
      ? decodePaginationKey(input.nextPaginationKey, ctx.pkAttr, ctx.skAttr)
      : undefined;
    const limit = input.limit ?? 50;
    const repo = await getMetadataRepository();
    const { records, lastEvaluatedKey } = await repo.listMetadataValuesPaginated(
      input.metadataTypeCode,
      lifecycleStatuses,
      {
        limit,
        exclusiveStartKey: eks,
      },
    );
    return { items: records.map(flattenMetadataValueForApi), lastEvaluatedKey };
  }

  const rows = await listValues(input.metadataTypeCode, lifecycleStatuses);
  const matched = rows.filter((v) => matchesSearchFilter(v, filter, lifecycleStatuses));

  return { items: await enrichMetadataValuesForApi(sortValuesForSearch(matched)) };
}

export const metadataService = {
  listTypes: (input: ListMetadataInput) => listMetadataTypesForRegistry(input, false).then((r) => r.items),
  listValues: (input: ListMetadataInput) => listMetadataValuesForRegistry(input, false).then((r) => r.items),
};

/** Parsed `GET /metadata/:entityType` input (host validates via Zod). */
export type RegistryGetMetadataInput =
  | { entityType: 'type'; metadataTypeCode: string; lifecycleStatuses: Status[] }
  | { entityType: 'value'; metadataTypeCode: string; valueCode: string; lifecycleStatuses: Status[] };

/**
 * Parsed `PATCH .../status` input (host validates via Zod).
 * Status enum validation runs in the schema layer (`parsePatchStatusBody`) before orchestration,
 * so the orchestrator receives the canonical `Status` and does not re-parse.
 */
export type RegistryPatchMetadataStatusInput =
  | { entityType: 'type'; userId?: string; metadataTypeCode: string; status: Status }
  | {
      entityType: 'value';
      userId?: string;
      metadataTypeCode: string;
      valueCode: string;
      status: Status;
    };

/** Parsed `GET .../audit` input (host validates via Zod). */
export type RegistryListMetadataAuditInput =
  | { entityType: 'type'; metadataTypeCode: string }
  | { entityType: 'value'; metadataTypeCode: string; valueCode: string };

/** Parsed soft-delete request (host validates body via Zod). */
export type RegistryDeleteMetadataValueInput = {
  metadataTypeCode: string;
  valueCode: string;
  userId?: string;
  reason?: string;
};

export async function orchestrateRegistryGet(
  input: RegistryGetMetadataInput,
): Promise<MetadataTypeRecord | MetadataValueApiModel> {
  if (input.entityType === 'type') {
    return resolveMetadataTypeGet(input.metadataTypeCode, input.lifecycleStatuses);
  }
  return resolveMetadataValueGetForApi(
    input.metadataTypeCode,
    input.valueCode,
    input.lifecycleStatuses,
  );
}

export type RegistryListResult =
  | { pagination: false; items: MetadataTypeListItem[] | MetadataValueApiModel[] }
  | {
      pagination: true;
      items: MetadataTypeListItem[] | MetadataValueApiModel[];
      nextPaginationKey?: string;
    };

/**
 * Registry list HTTP payload: non-paginated mode returns a bare array; paginated mode returns
 * `{ items, nextPaginationKey? }` (cursor omitted when absent).
 */
export type RegistryListHttpPayload<T> = T[] | { items: T[]; nextPaginationKey?: string };

export function shapeRegistryListHttpResponse<T>(
  result: RegistryListResult,
  items: T[],
): RegistryListHttpPayload<T> {
  if (!result.pagination) {
    return items;
  }
  return {
    items,
    ...(result.nextPaginationKey !== undefined ? { nextPaginationKey: result.nextPaginationKey } : {}),
  };
}

export async function orchestrateRegistryList(input: ListMetadataInput): Promise<RegistryListResult> {
  let paginated = registryListPaginationRequested(input);
  if (paginated && input.entityType === 'value' && hasApplicabilityListFilters(input)) {
    paginated = false;
  }

  if (input.entityType === 'type') {
    const { items, lastEvaluatedKey } = await listMetadataTypesForRegistry(input, paginated);
    if (!paginated) {
      return { pagination: false, items };
    }
    return {
      pagination: true,
      items,
      nextPaginationKey: encodePaginationKey(lastEvaluatedKey),
    };
  }

  const { items, lastEvaluatedKey } = await listMetadataValuesForRegistry(input, paginated);
  if (!paginated) {
    return { pagination: false, items };
  }
  return {
    pagination: true,
    items,
    nextPaginationKey: encodePaginationKey(lastEvaluatedKey),
  };
}

export async function orchestrateRegistryPost(
  input: RegistryPostMetadataInput,
): Promise<MetadataTypeRecord | MetadataValueApiModel> {
  if (input.entityType === 'type') {
    return upsertMetadataType(
      normalizeMetadataTypeInput(input.body as MetadataTypeInput & Record<string, unknown>),
      input.userId,
    );
  }
  const raw = input.body as MetadataValueInput & Record<string, unknown>;
  const metadataTypeCode = String(raw.metadataTypeCode).trim();
  const valueCode = (raw.valueCode ?? raw.metadataValueCode) as string;
  const existing = await getValue(metadataTypeCode, valueCode);
  const relationshipsSent = Object.prototype.hasOwnProperty.call(raw, 'relationships');
  const normalized = normalizeMetadataValueInput(
    { ...raw, valueCode, metadataValueCode: valueCode } as MetadataValueInput & Record<string, unknown>,
    existing,
  );
  const meta = await getMetadataRepository();
  const type = await meta.getMetadataType(metadataTypeCode);
  if (!type) {
    throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
  }

  const relationshipTargetCodes = relationshipsSent
    ? (normalized.relationships ?? []).map((x) => x.targetMetadataValueCode)
    : undefined;

  validateValueRelationshipsPayload(type, {
    mode: existing ? 'update' : 'create',
    relationshipsSent,
    targetCodes: relationshipsSent ? relationshipTargetCodes ?? [] : undefined,
  });

  if (relationshipsSent && relationshipTargetCodes?.length) {
    await assertRelationshipTargetsReferenceValidValues(meta, type, relationshipTargetCodes);
  }

  const { relationships: _relationships, ...valueBody } = normalized;
  const record = await upsertMetadataValue(metadataTypeCode, valueBody, input.userId, existing);

  const relRepo = await getRelationRepository();
  const actor = valueBody.createdBy ?? actorFromContext(input.userId);
  await syncMetadataValueRelationships(
    meta,
    relRepo,
    type,
    record.valueCode,
    relationshipsSent,
    relationshipsSent ? relationshipTargetCodes ?? [] : undefined,
    actor,
  );

  return enrichMetadataValueForApi(record);
}

export async function orchestrateRegistryPatchStatus(
  input: RegistryPatchMetadataStatusInput,
): Promise<MetadataTypeRecord | MetadataValueApiModel> {
  if (input.entityType === 'type') {
    return patchTypeStatus(input.metadataTypeCode, input.status, input.userId);
  }
  const record = await patchValueStatus(
    input.metadataTypeCode,
    input.valueCode,
    input.status,
    input.userId,
  );
  return enrichMetadataValueForApi(record);
}

export async function orchestrateRegistryListAudit(
  input: RegistryListMetadataAuditInput,
): Promise<AuditRecord[]> {
  if (input.entityType === 'type') {
    return listTypeAudit(input.metadataTypeCode);
  }
  return listValueAudit(input.metadataTypeCode, input.valueCode);
}

export async function orchestrateRegistryDeleteMetadataValue(
  input: RegistryDeleteMetadataValueInput,
): Promise<MetadataValueApiModel> {
  const record = await deleteMetadataValue(input.metadataTypeCode, input.valueCode, {
    reason: input.reason,
    userId: input.userId,
  });
  return enrichMetadataValueForApi(record);
}

export { orchestrateRegistryPostDraft, orchestrateRegistryPostCancelDraft } from './metadata-change-request.service';
export { orchestrateRegistryPostImpactPreview } from './metadata-impact-preview.service';
export { orchestrateRegistryPostPublish, publishChangeRequest } from './metadata-publish.service';
export type {
  ChangeRequestDraftResponse,
  ChangeRequestCancelledResponse,
} from '../models/change-request.types';
export type { ImpactPreviewResponse } from '../models/impact-preview.types';
export type { MetadataPublishResult, MetadataPublishResponse } from '../models/publish.types';
