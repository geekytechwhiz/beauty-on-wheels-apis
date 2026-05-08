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

import {
  flattenMetadataValueForApi,
  normalizeMetadataTypeInput,
  normalizeMetadataValueInput,
  type MetadataValueApiModel,
} from '../mappers/metadata-request.mapper';
import { getMetadataRepository } from '../dynamodb/dynamodb.client';

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

const PATCH_STATUS_INVALID =
  'status must be Active or Inactive (other common casings are accepted)';

/**
 * `PATCH` body `{ status }` for type/value activate endpoints. Trims and uppercases; rejects missing or unknown values.
 */
export function parsePatchStatusBody(raw: unknown): Status {
  if (raw === undefined || raw === null) {
    throw new ValidationError(PATCH_STATUS_INVALID, [{ field: 'status', message: 'Invalid' }]);
  }
  const status = String(raw).trim().toUpperCase() as Status;
  if (status !== STATUS.ACTIVE && status !== STATUS.INACTIVE) {
    throw new ValidationError(PATCH_STATUS_INVALID, [{ field: 'status', message: 'Invalid' }]);
  }
  return status;
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

export async function getType(metadataTypeCode: string): Promise<MetadataTypeRecord | null> {
  assertMetadataTypeCode(metadataTypeCode);
  return (await getMetadataRepository()).getMetadataType(metadataTypeCode);
}

export async function listTypes(filters: {
  status?: Status;
  module?: string;
  valueDataType?: string;
}): Promise<MetadataTypeRecord[]> {
  return (await getMetadataRepository()).listMetadataTypes(filters);
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

async function listMetadataTypesFromService(input: ListMetadataInput): Promise<MetadataTypeListItem[]> {
  const mode = resolveStatusMode(input);

  const base = {
    module: input.module,
    valueDataType: input.valueDataType,
  };

  const types =
    mode === 'all'
      ? await listTypes(base)
      : await listTypes({
          ...base,
          status: mode === 'inactive' ? STATUS.INACTIVE : STATUS.ACTIVE,
        });

  const valueListStatus: Status | null =
    mode === 'all' ? null : mode === 'inactive' ? STATUS.INACTIVE : STATUS.ACTIVE;

  const counts = await Promise.all(types.map((t) => listValues(t.metadataTypeCode, valueListStatus)));

  return types.map((t, i) => ({
    ...t,
    metadataValueCount: counts[i]!.length,
  }));
}

async function listMetadataValuesFromService(input: ListMetadataInput): Promise<MetadataValueApiModel[]> {
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
  const rows = await listValues(input.metadataTypeCode, repoStatus);

  const matchDefaultStatus: Status | null = mode === 'all' ? null : mode === 'inactive' ? STATUS.INACTIVE : STATUS.ACTIVE;
  const matched = rows.filter((v) => matchesSearchFilter(v, filter, matchDefaultStatus));

  return sortValuesForSearch(matched).map(flattenMetadataValueForApi);
}

export const metadataService = {
  listTypes: listMetadataTypesFromService,
  listValues: listMetadataValuesFromService,
};

/** Parsed `GET /metadata/:entityType` input (host validates via Zod). */
export type RegistryGetMetadataInput =
  | { entityType: 'type'; metadataTypeCode: string; mode: GetEntityByStatusMode }
  | { entityType: 'value'; metadataTypeCode: string; valueCode: string; mode: GetEntityByStatusMode };

/** Parsed `POST /metadata/:entityType` input (host validates via Zod). */
export type RegistryPostMetadataInput =
  | { entityType: 'type'; userId?: string; body: Record<string, unknown> }
  | { entityType: 'value'; userId?: string; body: Record<string, unknown> };

/** Parsed `PATCH .../status` input (host validates via Zod). */
export type RegistryPatchMetadataStatusInput =
  | { entityType: 'type'; userId?: string; metadataTypeCode: string; rawStatus: unknown }
  | {
      entityType: 'value';
      userId?: string;
      metadataTypeCode: string;
      valueCode: string;
      rawStatus: unknown;
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

export async function orchestrateRegistryList(
  input: ListMetadataInput,
): Promise<MetadataTypeListItem[] | MetadataValueApiModel[]> {
  if (input.entityType === 'type') {
    return metadataService.listTypes(input);
  }
  return metadataService.listValues(input);
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
    const status = parsePatchStatusBody(input.rawStatus);
    return patchTypeStatus(input.metadataTypeCode, status, input.userId);
  }
  const status = parsePatchStatusBody(input.rawStatus);
  const record = await patchValueStatus(
    input.metadataTypeCode,
    input.valueCode,
    status,
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
