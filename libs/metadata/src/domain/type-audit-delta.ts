import { metadataTypeUsesSeparateSchemaItem } from './constants';
import type { MetadataTypeRecord } from './types';

function sortKeysDeep(x: unknown): unknown {
  if (x === null || typeof x !== 'object') {
    return x;
  }
  if (Array.isArray(x)) {
    return x.map(sortKeysDeep);
  }
  const o = x as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    out[k] = sortKeysDeep(o[k]);
  }
  return out;
}

function jsonStable(v: unknown): string {
  if (v === undefined) {
    return '';
  }
  return JSON.stringify(sortKeysDeep(v));
}

function sortedTokens(arr: string[] | undefined): string[] {
  return [...(arr ?? [])].map(String).sort();
}

function listEq(a: string[] | undefined, b: string[] | undefined): boolean {
  return jsonStable(sortedTokens(a)) === jsonStable(sortedTokens(b));
}

/**
 * Subset of type fields for audit (no system keys, no metadataTypeCode, no attributeSchema body).
 */
export function metadataTypeToAuditSnapshot(r: MetadataTypeRecord): Record<string, unknown> {
  return {
    displayName: r.displayName,
    description: r.description,
    valueDataType: r.valueDataType,
    multiSelectAllowed: r.multiSelectAllowed,
    applicableModules: sortedTokens(r.applicableModules),
    status: r.status,
  };
}

/**
 * CREATE audit `newValue`: required product fields + `schemaVersion` (type entity version).
 */
export function typeCreateAuditNewValue(r: MetadataTypeRecord): Record<string, unknown> {
  return {
    displayName: r.displayName,
    valueDataType: r.valueDataType,
    multiSelectAllowed: r.multiSelectAllowed,
    applicableModules: [...(r.applicableModules ?? [])],
    status: r.status,
    schemaVersion: r.version,
  };
}

function attributeSchemaContentEq(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  return jsonStable(a ?? {}) === jsonStable(b ?? {});
}

/**
 * Delta between type snapshots; `attributeSchema` is never included — only `schemaVersion` when schema body changes.
 */
export function getMetadataTypeDelta(
  before: MetadataTypeRecord,
  after: MetadataTypeRecord,
): { oldValue: Record<string, unknown>; newValue: Record<string, unknown> } {
  const b = metadataTypeToAuditSnapshot(before);
  const a = metadataTypeToAuditSnapshot(after);
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};

  for (const key of ['displayName', 'description', 'valueDataType', 'multiSelectAllowed', 'status'] as const) {
    if (jsonStable(b[key]) === jsonStable(a[key])) {
      continue;
    }
    oldValue[key] = b[key];
    newValue[key] = a[key];
  }

  if (!listEq(before.applicableModules, after.applicableModules)) {
    oldValue.applicableModules = [...(before.applicableModules ?? [])];
    newValue.applicableModules = [...(after.applicableModules ?? [])];
  }

  const usesSchema = metadataTypeUsesSeparateSchemaItem(before.metadataTypeCode);
  const schemaChanged = !attributeSchemaContentEq(
    before.attributeSchema as Record<string, unknown> | undefined,
    after.attributeSchema as Record<string, unknown> | undefined,
  );

  if (usesSchema && schemaChanged) {
    oldValue.schemaVersion = before.version;
    newValue.schemaVersion = after.version;
  }

  return { oldValue, newValue };
}
