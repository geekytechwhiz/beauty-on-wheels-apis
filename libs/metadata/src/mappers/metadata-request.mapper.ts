import { createLogger } from '@api-hub/observability';

import { ValidationError } from '../domain/errors';
import { STATUS } from '../constants';
import type {
  Applicability,
  MetadataTypeInput,
  MetadataTypeRecord,
  MetadataValueInput,
  MetadataValueRecord,
  MetadataValueRelationshipInput,
  MetadataValueRelationshipResolved,
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

/**
 * Coerce request status to `ACTIVE` | `INACTIVE` (uppercase). Unknown non-empty values are
 * passed through (uppercased) so the downstream validator can reject them with the proper
 * "must be ACTIVE or INACTIVE" error instead of a misleading "required".
 */
function normalizeMetadataValueStatus(raw: unknown): Status | undefined {
  if (raw === undefined || raw === null) return undefined;
  const upper = String(raw).trim().toUpperCase();
  if (upper === '') return undefined;
  return upper as Status;
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

function hasOwnKey(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

/** Parsed `relationships` array for value upsert; duplicate codes rejected here for stable UX. */
export function parseRelationshipsFromRequestBody(rawRelationships: unknown): MetadataValueRelationshipInput[] {
  if (rawRelationships === undefined || rawRelationships === null) {
    return [];
  }
  if (!Array.isArray(rawRelationships)) {
    throw new ValidationError('relationships must be an array', [{ field: 'relationships', message: 'Invalid' }]);
  }
  const seen = new Set<string>();
  const out: MetadataValueRelationshipInput[] = [];
  for (let i = 0; i < rawRelationships.length; i++) {
    const item = rawRelationships[i];
    if (!item || typeof item !== 'object') {
      throw new ValidationError('Each relationships entry must be an object', [
        { field: `relationships[${i}]`, message: 'Invalid' },
      ]);
    }
    const code = (item as { targetMetadataValueCode?: unknown }).targetMetadataValueCode;
    if (code === undefined || code === null || String(code).trim() === '') {
      throw new ValidationError('targetMetadataValueCode is required on each relationship', [
        { field: `relationships[${i}].targetMetadataValueCode`, message: 'Required' },
      ]);
    }
    const normalized = String(code).trim();
    if (seen.has(normalized)) {
      throw new ValidationError('Duplicate targetMetadataValueCode in relationships', [
        { field: 'relationships', message: `Duplicate code: ${normalized}` },
      ]);
    }
    seen.add(normalized);
    out.push({ targetMetadataValueCode: normalized });
  }
  return out;
}

/**
 * Maps legacy / alternate request shapes to {@link MetadataTypeInput}
 * (`name` → `displayName`, `datatype` → `valueDataType`, `module` string → `applicableModules`).
 *
 * **Only keys present on the request body are emitted** (after alias resolution). Omitted fields must not
 * appear as `undefined` values — that prevented PATCH-style merges from distinguishing "not sent" from
 * `"field": null` or empty overrides downstream.
 */
export function normalizeMetadataTypeInput(
  body: MetadataTypeInput & Record<string, unknown>,
): MetadataTypeInput {
  const out: MetadataTypeInput = {
    metadataTypeCode: String(body.metadataTypeCode),
  };

  if (hasOwnKey(body, 'displayName') || hasOwnKey(body, 'name')) {
    const raw = hasOwnKey(body, 'displayName') ? body.displayName : body.name;
    out.displayName = raw as string | undefined;
  }
  if (hasOwnKey(body, 'description')) {
    out.description = body.description as string | undefined;
  }
  if (hasOwnKey(body, 'valueDataType') || hasOwnKey(body, 'datatype')) {
    out.valueDataType = (body.valueDataType ?? body.datatype) as string | undefined;
  }
  if (hasOwnKey(body, 'multiSelectAllowed')) {
    out.multiSelectAllowed = body.multiSelectAllowed as boolean | undefined;
  }
  if (hasOwnKey(body, 'applicableModules')) {
    const raw = body.applicableModules as string[] | null | undefined;
    if (raw === null) {
      out.applicableModules = null as unknown as string[];
    } else if (raw !== undefined) {
      out.applicableModules = raw.map(normalizeApplicableModuleToken);
    }
  } else if (hasOwnKey(body, 'module')) {
    out.applicableModules = [normalizeApplicableModuleToken(String(body.module))];
  }
  if (hasOwnKey(body, 'valueApplicabilityConfig')) {
    out.valueApplicabilityConfig = body.valueApplicabilityConfig as MetadataTypeInput['valueApplicabilityConfig'];
  }
  if (hasOwnKey(body, 'attributeSchema')) {
    out.attributeSchema = body.attributeSchema as Record<string, unknown> | undefined;
  }
  if (hasOwnKey(body, 'status')) {
    if (body.status === null) {
      out.status = null as unknown as Status;
    } else {
      const s = normalizeMetadataTypeStatus(body.status);
      if (s !== undefined) {
        out.status = s;
      }
    }
  }
  if (hasOwnKey(body, 'createdBy')) {
    out.createdBy = body.createdBy as string | undefined;
  }
  if (hasOwnKey(body, 'lastModifiedBy') || hasOwnKey(body, 'updatedBy')) {
    out.lastModifiedBy = (body.lastModifiedBy ?? body.updatedBy) as string | undefined;
  }
  if (hasOwnKey(body, 'supportsRelations')) {
    out.supportsRelations = body.supportsRelations as boolean | undefined;
  }
  if (hasOwnKey(body, 'relationFieldLabel')) {
    out.relationFieldLabel = body.relationFieldLabel as string | null | undefined;
  }
  if (hasOwnKey(body, 'targetMetadataTypeCode')) {
    out.targetMetadataTypeCode = body.targetMetadataTypeCode as string | null | undefined;
  }
  if (hasOwnKey(body, 'selectionMode')) {
    out.selectionMode = body.selectionMode as MetadataTypeInput['selectionMode'];
  }
  if (hasOwnKey(body, 'relationRequired')) {
    out.relationRequired = body.relationRequired as boolean | null | undefined;
  }
  if (hasOwnKey(body, 'relationType')) {
    out.relationType = body.relationType as MetadataTypeInput['relationType'];
  }

  return out;
}

/**
 * PATCH-style merge for metadata type updates. Overwrites an existing field only when the patch
 * carries an explicit value (`!== undefined`). `null` is explicit and overwrites for downstream validation.
 */
export function mergeMetadataTypeForUpdate(
  existing: MetadataTypeRecord,
  patch: MetadataTypeInput,
): MetadataTypeInput {
  const pick = <T, U extends T | undefined>(next: U, prev: T): T | U =>
    next !== undefined ? next : prev;

  /** Like `pick`, but allows explicit `null` from the patch and `null` on the stored record (relation config fields). */
  const pickNullable = <T>(next: T | null | undefined, prev: T | null | undefined): T | null | undefined =>
    next !== undefined ? next : prev;

  const supportsRelations =
    patch.supportsRelations !== undefined ? Boolean(patch.supportsRelations) : existing.supportsRelations;

  const core: MetadataTypeInput = {
    metadataTypeCode: existing.metadataTypeCode,
    displayName: pick(patch.displayName, existing.displayName),
    description: pick(patch.description, existing.description),
    valueDataType: pick(patch.valueDataType, existing.valueDataType),
    multiSelectAllowed: pick(patch.multiSelectAllowed, existing.multiSelectAllowed),
    applicableModules: pick(patch.applicableModules, existing.applicableModules),
    valueApplicabilityConfig: pick(patch.valueApplicabilityConfig, existing.valueApplicabilityConfig),
    attributeSchema: pick(patch.attributeSchema, existing.attributeSchema),
    status: pick(patch.status, existing.status),
    createdBy: pick(patch.createdBy, existing.createdBy),
    lastModifiedBy: pick(patch.lastModifiedBy, existing.lastModifiedBy),
    supportsRelations,
  };

  if (!supportsRelations) {
    return {
      ...core,
      relationFieldLabel: null,
      targetMetadataTypeCode: null,
      selectionMode: null,
      relationRequired: null,
      relationType: null,
    };
  }

  return {
    ...core,
    relationFieldLabel: pickNullable(patch.relationFieldLabel, existing.relationFieldLabel),
    targetMetadataTypeCode: pickNullable(patch.targetMetadataTypeCode, existing.targetMetadataTypeCode),
    selectionMode: pickNullable(patch.selectionMode, existing.selectionMode),
    relationRequired: pickNullable(patch.relationRequired, existing.relationRequired),
    relationType: pickNullable(patch.relationType, existing.relationType),
  };
}

/**
 * Maps alternate request shapes to {@link MetadataValueInput}:
 * `metadataValueCode` → `valueCode`, `valueAttributes` → `attributes`,
 * flat Figma fields → nested `applicability` (tokens normalized: trim, uppercase, deduped).
 *
 * When `existing` is set (update path), fields omitted in the request keep the stored value; applicability
 * is only replaced when the body explicitly includes `applicability` or any `applicable*` flat key.
 *
 * **`label`:** When the `label` key is absent, the previous label is preserved on update. When `label` is
 * present (including `""`, whitespace-only, or `null`), the raw value is forwarded for validation — invalid
 * explicit updates are not silently replaced with the stored label.
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

  // Status is required on every write (create + update). Do NOT fall back to `existing?.status`
  // — silent inheritance let omitted-status updates persist whatever the previous version was
  // (often INACTIVE), which is not the desired contract. Validator will reject undefined.
  const resolvedStatus = normalizeMetadataValueStatus(body.status);

  // Label: distinguish "key omitted" (PATCH: preserve existing) from "explicit empty/null" (invalid).
  // Passing explicit null/""/whitespace through lets validateMetadataValueInput surface a 400.
  let label: string;
  if (hasOwnKey(raw, 'label')) {
    const lv = raw.label;
    if (lv === null) {
      label = null as unknown as string;
    } else if (lv === undefined) {
      label = '';
    } else {
      label = String(lv);
    }
  } else if (existing) {
    label = existing.label;
  } else {
    label = '';
  }

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

  if (hasOwnKey(raw, 'relationships')) {
    result.relationships = parseRelationshipsFromRequestBody(raw.relationships);
  }

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
  /** Same as `status`; explicit name because `relationships[].relationStatus` is relation lifecycle, not value. */
  metadataValueStatus: Status;
  valueAttributes: Record<string, unknown>;
  applicableModules: string[];
  applicableCategories: string[];
  applicableConditions: string[];
  applicableCountries: string[];
  applicableLanguages: string[];
  /** Present when the parent metadata type has `supportsRelations` (may be empty). */
  relationships?: MetadataValueRelationshipResolved[];
};

export function flattenMetadataValueForApi(record: MetadataValueRecord): MetadataValueApiModel {
  const { valueCode, applicability, attributes, status, ...rest } = record;
  return {
    ...rest,
    status,
    metadataValueStatus: status,
    metadataValueCode: valueCode,
    valueAttributes: attributes,
    applicableModules: applicability.module,
    applicableCategories: applicability.category,
    applicableConditions: applicability.condition,
    applicableCountries: applicability.country,
    applicableLanguages: applicability.language ?? [],
  };
}
