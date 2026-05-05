import type {
  AuditRecord,
  MetadataTypeInput,
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
} from '../domain/errors';
import { STATUS } from '../constants';
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
  type MetadataValueApiModel,
} from '../mappers/metadata-request.mapper';
import { getMetadataRepository } from '../dynamodb/dynamodb.client';

function actorFromContext(userId?: string): string | undefined {
  return userId;
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
  validateMetadataTypeInput(body, true);
  return repo.updateMetadataType(body, actor);
}

export async function patchTypeStatus(
  metadataTypeCode: string,
  status: Status,
  userId?: string,
): Promise<MetadataTypeRecord> {
  assertMetadataTypeCode(metadataTypeCode);
  return (await getMetadataRepository()).patchMetadataTypeStatus(metadataTypeCode, status, actorFromContext(userId));
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
  if (!existing) {
    validateMetadataValueInput(body, {
      metadataType: type,
      mode: 'create',
      mergedIsGlobal: body.isGlobal!,
    });
    return repo.createMetadataValue(metadataTypeCode, body, actor);
  }
  const mergedIsGlobal = body.isGlobal ?? existing.isGlobal;
  validateMetadataValueInput(body, {
    metadataType: type,
    mode: 'update',
    mergedIsGlobal,
    expectedValueCode: existing.valueCode,
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

async function listMetadataTypesFromService(input: ListMetadataInput): Promise<MetadataTypeRecord[]> {
  const mode = resolveStatusMode(input);

  const base = {
    module: input.module,
    valueDataType: input.valueDataType,
  };

  if (mode === 'all') {
    return listTypes(base);
  }

  return listTypes({
    ...base,
    status: mode === 'inactive' ? STATUS.INACTIVE : STATUS.ACTIVE,
  });
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
