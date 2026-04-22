import { createLogger } from '@api-hub/logger';
import type {
  Applicability,
  AuditRecord,
  MetadataTypeInput,
  MetadataTypeRecord,
  MetadataValueInput,
  MetadataValueRecord,
  Status,
  ValueSearchFilter,
} from '@api-hub/metadata';
import {
  STATUS,
  applicabilityKeysPresentInBody,
  mapFlatAndNestedToApplicability,
} from '@api-hub/metadata';
import { getMetadataRepository } from '../repositories/dynamodb';

const log = createLogger({
  service: 'metadata-registry-service',
  redactPII: true,
});

function actorFromContext(userId?: string): string | undefined {
  return userId;
}

/** Same rule as {@link assertEnumTokenArray} in metadata validators. */
const APPLICABLE_MODULE_TOKEN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Coerce UI-friendly status strings (e.g. `Active`) to `ACTIVE` | `INACTIVE`.
 * Unknown values are left unchanged so validation can reject them.
 */
function normalizeMetadataTypeStatus(raw: unknown): Status | undefined {
  if (raw === undefined || raw === null) return undefined;
  const upper = String(raw).trim().toUpperCase();
  if (upper === STATUS.ACTIVE || upper === STATUS.INACTIVE) return upper;
  return raw as Status;
}

/** Coerce request status to `ACTIVE` | `INACTIVE` (uppercase). */
function normalizeMetadataValueStatus(raw: unknown): Status | undefined {
  if (raw === undefined || raw === null) return undefined;
  const upper = String(raw).trim().toUpperCase();
  if (upper === STATUS.ACTIVE || upper === STATUS.INACTIVE) return upper;
  return undefined;
}

/**
 * Coerce display-style module names (e.g. `CarePlan`) to catalog tokens (`CARE_PLAN`).
 * Already-valid tokens are returned as-is.
 */
function normalizeApplicableModuleToken(raw: string): string {
  const t = raw.trim();
  if (APPLICABLE_MODULE_TOKEN.test(t)) return t;
  const withBreaks = t
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2');
  const cleaned = withBreaks
    .replace(/[-\s]+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .toUpperCase()
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (APPLICABLE_MODULE_TOKEN.test(cleaned)) return cleaned;
  const compact = t.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (APPLICABLE_MODULE_TOKEN.test(compact)) return compact;
  return t;
}

/**
 * Maps legacy / alternate request shapes to {@link MetadataTypeInput}
 * (`name` → `displayName`, `datatype` → `valueDataType`, `module` string → `applicableModules`).
 */
export function normalizeMetadataTypeInput(
  body: MetadataTypeInput & Record<string, unknown>,
): MetadataTypeInput {
  const displayName = (body.displayName ?? body.name) as string | undefined;
  const valueDataType = (body.valueDataType ?? body.datatype) as string | undefined;
  const fromModule = body.module !== undefined ? [String(body.module)] : undefined;
  const rawModules = (body.applicableModules ?? fromModule) as string[] | undefined;
  const applicableModules =
    rawModules === undefined ? undefined : rawModules.map(normalizeApplicableModuleToken);
  const lastModifiedBy = (body.lastModifiedBy ?? body.updatedBy) as string | undefined;
  const status = normalizeMetadataTypeStatus(body.status);

  return {
    metadataTypeCode: body.metadataTypeCode,
    displayName,
    description: body.description,
    valueDataType,
    multiSelectAllowed: body.multiSelectAllowed,
    applicableModules,
    valueApplicabilityConfig: body.valueApplicabilityConfig,
    attributeSchema: body.attributeSchema,
    status,
    createdBy: body.createdBy,
    lastModifiedBy,
  };
}

/**
 * Maps alternate request shapes to {@link MetadataValueInput}:
 * `metadataValueCode` → `valueCode`, `valueAttributes` → `attributes`,
 * flat Figma fields → nested `applicability` (tokens normalized: trim, uppercase, deduped).
 *
 * When `existing` is set (update path), fields omitted in the request keep the stored value; applicability
 * is only replaced when the body explicitly includes `applicability` or any `applicable*` flat key.
 */
export function normalizeMetadataValueInput(
  body: MetadataValueInput & Record<string, unknown>,
  existing?: MetadataValueRecord | null,
): MetadataValueInput {
  const raw = body as Record<string, unknown>;
  const valueCode =
    (body.valueCode as string | undefined) ?? (body.metadataValueCode as string | undefined) ?? existing?.valueCode ?? '';

  const attributes =
    body.attributes !== undefined
      ? body.attributes
      : body.valueAttributes !== undefined
        ? (body.valueAttributes as Record<string, unknown>)
        : existing
          ? existing.attributes
          : undefined;

  const useExistingApplic = existing && !applicabilityKeysPresentInBody(raw);
  const applicability = useExistingApplic
    ? existing.applicability
    : mapFlatAndNestedToApplicability(raw, body.applicability as Applicability | undefined);

  const resolvedStatus = normalizeMetadataValueStatus(body.status) ?? existing?.status;

  const label =
    body.label !== undefined && body.label !== null && String(body.label).trim() !== ''
      ? String(body.label)
      : (existing?.label ?? '');

  const result: MetadataValueInput = {
    valueCode,
    label,
    description: body.description !== undefined ? body.description : existing?.description,
    sortOrder: body.sortOrder !== undefined ? body.sortOrder : existing?.sortOrder,
    status: resolvedStatus,
    isGlobal: body.isGlobal !== undefined ? body.isGlobal : existing?.isGlobal,
    attributes,
    applicability,
    createdBy: body.createdBy,
  };

  log.debug({
    event: 'metadata_value.normalize',
    valueCode: result.valueCode,
    isGlobal: result.isGlobal,
  });

  return result;
}

/** API response shape aligned with Figma (flat applicability + aliases), plus canonical nested fields. */
export type MetadataValueApiModel = MetadataValueRecord & {
  metadataValueCode: string;
  valueAttributes: Record<string, unknown>;
  applicableModules: string[];
  applicableCategories: string[];
  applicableConditions: string[];
  applicableCountries: string[];
  applicableLanguages: string[];
};

export function flattenMetadataValueForApi(record: MetadataValueRecord): MetadataValueApiModel {
  return {
    ...record,
    metadataValueCode: record.valueCode,
    valueAttributes: record.attributes,
    applicableModules: record.applicability.module,
    applicableCategories: record.applicability.category,
    applicableConditions: record.applicability.condition,
    applicableCountries: record.applicability.country,
    applicableLanguages: record.applicability.language ?? [],
  };
}

/** POST /metadata-types — create if missing, else update. */
export async function upsertMetadataType(body: MetadataTypeInput, userId?: string): Promise<MetadataTypeRecord> {
  const repo = await getMetadataRepository();
  const actor = actorFromContext(userId);
  const existing = await repo.getMetadataType(body.metadataTypeCode);
  if (!existing) {
    return repo.createMetadataType(body, actor);
  }
  return repo.updateMetadataType(body, actor);
}

export async function patchTypeStatus(
  metadataTypeCode: string,
  status: Status,
  userId?: string,
): Promise<MetadataTypeRecord> {
  return (await getMetadataRepository()).patchMetadataTypeStatus(metadataTypeCode, status, actorFromContext(userId));
}

export async function getType(metadataTypeCode: string): Promise<MetadataTypeRecord | null> {
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
  const existing =
    preloaded !== undefined ? preloaded : await repo.getMetadataValue(metadataTypeCode, body.valueCode);
  if (!existing) {
    return repo.createMetadataValue(metadataTypeCode, body, actor);
  }
  return repo.updateMetadataValue(metadataTypeCode, body, actor, existing);
}

export async function patchValueStatus(
  metadataTypeCode: string,
  valueCode: string,
  status: Status,
  userId?: string,
): Promise<MetadataValueRecord> {
  return (await getMetadataRepository()).patchMetadataValueStatus(
    metadataTypeCode,
    valueCode,
    status,
    actorFromContext(userId),
  );
}

export async function getValue(metadataTypeCode: string, valueCode: string): Promise<MetadataValueRecord | null> {
  return (await getMetadataRepository()).getMetadataValue(metadataTypeCode, valueCode);
}

export async function listValues(metadataTypeCode: string, status?: Status): Promise<MetadataValueRecord[]> {
  return (await getMetadataRepository()).listMetadataValues(metadataTypeCode, status);
}

export async function listTypeAudit(metadataTypeCode: string): Promise<AuditRecord[]> {
  return (await getMetadataRepository()).listTypeAudit(metadataTypeCode);
}

export async function listValueAudit(metadataTypeCode: string, valueCode: string): Promise<AuditRecord[]> {
  return (await getMetadataRepository()).listValueAudit(metadataTypeCode, valueCode);
}

export { STATUS, type Status, type ValueSearchFilter };
