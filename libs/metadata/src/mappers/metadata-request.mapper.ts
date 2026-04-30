import { createLogger } from '@api-hub/logger';

import { STATUS } from '../constants';
import type {
  Applicability,
  MetadataTypeInput,
  MetadataValueInput,
  MetadataValueRecord,
  Status,
} from '../models/types';
import {
  applicabilityKeysPresentInBody,
  mapFlatAndNestedToApplicability,
} from '../mappers/metadata-value-request';

const log = createLogger({
  service: 'metadata-registry-service',
  redactPII: true,
});

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
    (body.valueCode as string | undefined) ??
    (body.metadataValueCode as string | undefined) ??
    existing?.valueCode ??
    '';

  const attributes =
    body.attributes !== undefined
      ? body.attributes
      : body.valueAttributes !== undefined
        ? (body.valueAttributes as Record<string, unknown>)
        : existing
          ? existing.attributes
          : undefined;

  const useExistingApplic = Boolean(existing && !applicabilityKeysPresentInBody(raw));
  const applicability = useExistingApplic
    ? existing!.applicability
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

/**
 * Public API response for value resources (GET / list / search / POST / PATCH): flat `applicable*` lists,
 * `metadataValueCode` and `valueAttributes` only — no `valueCode`, nested `applicability`, or duplicate `attributes`.
 */
export type MetadataValueApiModel = Omit<MetadataValueRecord, 'valueCode' | 'applicability' | 'attributes'> & {
  metadataValueCode: string;
  valueAttributes: Record<string, unknown>;
  applicableModules: string[];
  applicableCategories: string[];
  applicableConditions: string[];
  applicableCountries: string[];
  applicableLanguages: string[];
};

export function flattenMetadataValueForApi(record: MetadataValueRecord): MetadataValueApiModel {
  const { valueCode, applicability, attributes, ...rest } = record;
  return {
    ...rest,
    metadataValueCode: valueCode,
    valueAttributes: attributes,
    applicableModules: applicability.module,
    applicableCategories: applicability.category,
    applicableConditions: applicability.condition,
    applicableCountries: applicability.country,
    applicableLanguages: applicability.language ?? [],
  };
}
