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

import type { ListMetadataInput } from '../types/list-metadata-input';
import type { ListTypesFilter, MetadataTypeListEntry } from '../repositories/metadata-registry.repository.interface';
import { decodePaginationKey, encodePaginationKey } from '../lib/pagination-key';

import {
  flattenMetadataValueForApi,
  normalizeMetadataTypeInput,
  normalizeMetadataValueInput,
  type MetadataValueApiModel,
} from '../mappers/metadata-request.mapper';
import { getMetadataRepository, getMetadataRegistryDynamoContext } from '../dynamodb/dynamodb.client';

function actorFromContext(userId?: string): string | undefined {
  return userId;
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
  const rows = await repo.listMetadataValues(QUESTION_TYPE_METADATA_CODE, STATUS.ACTIVE);
  if (rows.length === 0) {
    throw new ValidationError('QuestionType metadata has no active values; cannot validate questionType', [
      { field: 'attributes.questionType', message: 'Catalog empty' },
    ]);
  }
  return rows.map((v) => v.valueCode);
}

/**
 * `include-inactive` or `includeInactive` (query) — when true, admin/history: no active-only filter on list/get.
 */
export function parseQueryIncludeInactive(q: Record<string, string | undefined>): boolean {
  const raw = q['include-inactive'] ?? q.includeInactive;
  if (raw === undefined || raw === '') {
    return false;
  }
  const s = String(raw).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

/**
 * GET single type/value: how to apply `status` on the latest entity.
 * - `active` — default; 404 unless entity is ACTIVE
 * - `inactive` — 404 unless entity is INACTIVE (`status=INACTIVE` only)
 * - `all` — return if present (any status); `include-inactive=true` / `includeInactive=true`, or `status=ALL` / `BOTH`
 */
export type GetEntityByStatusMode = 'active' | 'inactive' | 'all';

export function parseGetEntityStatusMode(q: Record<string, string | undefined>): GetEntityByStatusMode {
  if (parseQueryIncludeInactive(q)) {
    return 'all';
  }
  const status = q.status;
  if (status === undefined || String(status).trim() === '') {
    return 'active';
  }
  const s = String(status).trim().toUpperCase();
  if (s === 'ALL' || s === 'BOTH') {
    return 'all';
  }
  if (s === STATUS.INACTIVE) {
    return 'inactive';
  }
  if (s === STATUS.ACTIVE) {
    return 'active';
  }
  return 'active';
}

/** GET list: default ACTIVE only; `status=INACTIVE` for inactive only; `include-inactive` for all (admin). */
export type ListEntityStatusMode = 'active' | 'inactive' | 'all';

export function parseListEntityStatusMode(q: Record<string, string | undefined>): ListEntityStatusMode {
  if (parseQueryIncludeInactive(q)) {
    return 'all';
  }
  const raw = q.status;
  if (raw !== undefined && String(raw).trim() !== '') {
    const s = String(raw).trim().toUpperCase();
    if (s === STATUS.INACTIVE) {
      return 'inactive';
    }
  }
  return 'active';
}

/** List metadata (types/values): default ACTIVE; `status=INACTIVE` inactive only; `includeInactive` → both (wins over `status`). */
export function resolveStatusMode(input: ListMetadataInput): ListEntityStatusMode {
  if (input.includeInactive) {
    return 'all';
  }
  if (input.status === STATUS.INACTIVE) {
    return 'inactive';
  }
  return 'active';
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
  mode: ListEntityStatusMode,
  activeValueCount: number,
  inactiveValueCount: number,
): number {
  if (mode === 'all') {
    return activeValueCount + inactiveValueCount;
  }
  if (mode === 'inactive') {
    return inactiveValueCount;
  }
  return activeValueCount;
}

export async function getType(metadataTypeCode: string): Promise<MetadataTypeRecord | null> {
  assertMetadataTypeCode(metadataTypeCode);
  return (await getMetadataRepository()).getMetadataType(metadataTypeCode);
}

export async function listTypes(filters: {
  status?: Status;
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
  mode: GetEntityByStatusMode,
): Promise<MetadataTypeRecord> {
  const t = await getType(metadataTypeCode);
  if (!t) {
    throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
  }
  if (mode === 'all') {
    return t;
  }
  if (mode === 'inactive') {
    if (t.status !== STATUS.INACTIVE) {
      throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
    }
    return t;
  }
  if (t.status !== STATUS.ACTIVE) {
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
    return repo.createMetadataType(body, actor);
  }
  assertPostUpsertAllowedForLatestStatus(existing.status, body.status);
  validateMetadataTypeInput(body, true);
  const mergedSchema =
    body.attributeSchema !== undefined ? body.attributeSchema : existing.attributeSchema;
  const oldMap = attributeSchemaFieldMapForCompatibility(
    existing.attributeSchema as Record<string, unknown> | undefined,
  );
  const newMap = attributeSchemaFieldMapForCompatibility(mergedSchema as Record<string, unknown> | undefined);
  if (!isAttributeSchemaCompatibleExtension(oldMap, newMap)) {
    throw new ValidationError('attributeSchema is not a compatible extension of the existing schema', [
      {
        field: 'attributeSchema',
        message: 'Cannot remove or change existing attribute definitions; only additive extensions are allowed',
      },
    ]);
  }
  return repo.updateMetadataType(body, actor);
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
  assertPatchStatusAllowedForInactiveRecord(existing.status, status);
  assertMetadataTypeCode(metadataTypeCode);
  const type = await repo.getMetadataType(metadataTypeCode);
  if (!type) {
    throw new NotFoundError(`Metadata type ${metadataTypeCode} not found`);
  }
  assertMetadataTypeActiveForValueMutation(type, metadataTypeCode);
  return repo.patchMetadataValueStatus(metadataTypeCode, valueCode, status, actorFromContext(userId));
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
  mode: GetEntityByStatusMode,
): Promise<MetadataValueApiModel> {
  const v = await getValue(metadataTypeCode, valueCode);
  if (!v) {
    throw new NotFoundError(`Value ${valueCode} not found`);
  }
  if (mode === 'all') {
    return flattenMetadataValueForApi(v);
  }
  if (mode === 'inactive') {
    if (v.status !== STATUS.INACTIVE) {
      throw new NotFoundError(`Value ${valueCode} not found`);
    }
    return flattenMetadataValueForApi(v);
  }
  if (v.status !== STATUS.ACTIVE) {
    throw new NotFoundError(`Value ${valueCode} not found`);
  }
  return flattenMetadataValueForApi(v);
}

/**
 * @param statusOrAll - `null` = list all statuses (use with `include-inactive`); omitted/ACTIVE = ACTIVE only; `INACTIVE` = inactive only
 */
export async function listValues(
  metadataTypeCode: string,
  statusOrAll?: Status | null,
): Promise<MetadataValueRecord[]> {
  assertMetadataTypeCode(metadataTypeCode);
  return (await getMetadataRepository()).listMetadataValues(metadataTypeCode, statusOrAll);
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
  mode: ListEntityStatusMode,
): MetadataTypeListItem[] {
  return entries.map((e) => ({
    ...e.type,
    metadataValueCount: metadataTypeListItemValueCount(mode, e.activeValueCount, e.inactiveValueCount),
  }));
}

async function listMetadataTypesForRegistry(
  input: ListMetadataInput,
  paginated: boolean,
): Promise<{ items: MetadataTypeListItem[]; lastEvaluatedKey?: Record<string, unknown> }> {
  const mode = resolveStatusMode(input);

  const filter: ListTypesFilter = {
    module: input.module,
    valueDataType: input.valueDataType,
    ...(mode === 'all'
      ? {}
      : { status: mode === 'inactive' ? STATUS.INACTIVE : STATUS.ACTIVE }),
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
    return { items: mapTypeEntriesToListItems(entries, mode), lastEvaluatedKey };
  }

  const entries = await repo.listMetadataTypes(filter);
  return { items: mapTypeEntriesToListItems(entries, mode) };
}

async function listMetadataValuesForRegistry(
  input: ListMetadataInput,
  paginated: boolean,
): Promise<{ items: MetadataValueApiModel[]; lastEvaluatedKey?: Record<string, unknown> }> {
  const mode = resolveStatusMode(input);

  const filter: ValueSearchFilter = {};
  if (mode === 'active') {
    filter.status = STATUS.ACTIVE;
  } else if (mode === 'inactive') {
    filter.status = STATUS.INACTIVE;
  }

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

  const repoStatus = mode === 'all' ? null : mode === 'inactive' ? STATUS.INACTIVE : STATUS.ACTIVE;
  const matchDefaultStatus: Status | null =
    mode === 'all' ? null : mode === 'inactive' ? STATUS.INACTIVE : STATUS.ACTIVE;

  const allowPaginatedValues = paginated && !hasApplicabilityListFilters(input);

  if (allowPaginatedValues) {
    const ctx = await getMetadataRegistryDynamoContext();
    const eks = input.nextPaginationKey
      ? decodePaginationKey(input.nextPaginationKey, ctx.pkAttr, ctx.skAttr)
      : undefined;
    const limit = input.limit ?? 50;
    const repo = await getMetadataRepository();
    const { records, lastEvaluatedKey } = await repo.listMetadataValuesPaginated(input.metadataTypeCode, repoStatus, {
      limit,
      exclusiveStartKey: eks,
    });
    return { items: records.map(flattenMetadataValueForApi), lastEvaluatedKey };
  }

  const rows = await listValues(input.metadataTypeCode, repoStatus);
  const matched = rows.filter((v) => matchesSearchFilter(v, filter, matchDefaultStatus));

  return { items: sortValuesForSearch(matched).map(flattenMetadataValueForApi) };
}

export const metadataService = {
  listTypes: (input: ListMetadataInput) => listMetadataTypesForRegistry(input, false).then((r) => r.items),
  listValues: (input: ListMetadataInput) => listMetadataValuesForRegistry(input, false).then((r) => r.items),
};

/** Parsed `GET /metadata/:entityType` input (host validates via Zod). */
export type RegistryGetMetadataInput =
  | { entityType: 'type'; metadataTypeCode: string; mode: GetEntityByStatusMode }
  | { entityType: 'value'; metadataTypeCode: string; valueCode: string; mode: GetEntityByStatusMode };

/** Parsed `POST /metadata/:entityType` input (host validates via Zod). */
export type RegistryPostMetadataInput =
  | { entityType: 'type'; userId?: string; body: Record<string, unknown> }
  | { entityType: 'value'; userId?: string; body: Record<string, unknown> };

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

export async function orchestrateRegistryGet(
  input: RegistryGetMetadataInput,
): Promise<MetadataTypeRecord | MetadataValueApiModel> {
  if (input.entityType === 'type') {
    return resolveMetadataTypeGet(input.metadataTypeCode, input.mode);
  }
  return resolveMetadataValueGetForApi(input.metadataTypeCode, input.valueCode, input.mode);
}

export type RegistryListResult =
  | { pagination: false; items: MetadataTypeListItem[] | MetadataValueApiModel[] }
  | {
      pagination: true;
      items: MetadataTypeListItem[] | MetadataValueApiModel[];
      nextPaginationKey?: string;
    };

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
  const normalized = normalizeMetadataValueInput(
    { ...raw, valueCode, metadataValueCode: valueCode } as MetadataValueInput & Record<string, unknown>,
    existing,
  );
  const record = await upsertMetadataValue(metadataTypeCode, normalized, input.userId, existing);
  return flattenMetadataValueForApi(record);
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
  return flattenMetadataValueForApi(record);
}

export async function orchestrateRegistryListAudit(
  input: RegistryListMetadataAuditInput,
): Promise<AuditRecord[]> {
  if (input.entityType === 'type') {
    return listTypeAudit(input.metadataTypeCode);
  }
  return listValueAudit(input.metadataTypeCode, input.valueCode);
}
