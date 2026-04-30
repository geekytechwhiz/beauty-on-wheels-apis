import { isApplicabilityRestricting, isMetadataValueStructureBreaking } from './diff';
import type { Applicability, MetadataValueRecord } from './types';

const APPLIC_DIMS: { key: keyof Applicability; flat: string }[] = [
  { key: 'module', flat: 'applicableModules' },
  { key: 'category', flat: 'applicableCategories' },
  { key: 'condition', flat: 'applicableConditions' },
  { key: 'country', flat: 'applicableCountries' },
  { key: 'language', flat: 'applicableLanguages' },
];

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
 * Public snapshot of a value for delta comparison (no system/derived fields).
 */
export function metadataValueToAuditSnapshot(r: MetadataValueRecord): Record<string, unknown> {
  const ap = r.applicability;
  return {
    metadataValueCode: r.valueCode,
    label: r.label,
    description: r.description,
    sortOrder: r.sortOrder,
    status: r.status,
    isGlobal: r.isGlobal,
    valueAttributes: { ...r.attributes },
    applicableModules: sortedTokens(ap.module),
    applicableCategories: sortedTokens(ap.category),
    applicableConditions: sortedTokens(ap.condition),
    applicableCountries: sortedTokens(ap.country),
    applicableLanguages: sortedTokens(ap.language),
  };
}

/**
 * `newValue` for CREATE audit: minimal required product fields only.
 */
export function valueCreateAuditNewValue(r: MetadataValueRecord): Record<string, unknown> {
  return {
    metadataValueCode: r.valueCode,
    label: r.label,
    status: r.status,
    isGlobal: r.isGlobal,
  };
}

function valueAttributesOnlyDelta(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { old: Record<string, unknown>; newAttrs: Record<string, unknown> } | null {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const o: Record<string, unknown> = {};
  const n: Record<string, unknown> = {};
  for (const k of keys) {
    const be = k in before ? before[k] : undefined;
    const af = k in after ? after[k] : undefined;
    if (jsonStable(be) === jsonStable(af)) {
      continue;
    }
    if (k in before) {
      o[k] = be;
    }
    if (k in after) {
      n[k] = af;
    }
  }
  if (Object.keys(o).length === 0 && Object.keys(n).length === 0) {
    return null;
  }
  return { old: o, newAttrs: n };
}

/**
 * Delta between two value snapshots. Only includes changed keys (incl. per-dimension applicability, deep valueAttributes).
 */
export function getMetadataValueDelta(
  before: MetadataValueRecord,
  after: MetadataValueRecord,
): { oldValue: Record<string, unknown>; newValue: Record<string, unknown> } {
  const b = metadataValueToAuditSnapshot(before);
  const a = metadataValueToAuditSnapshot(after);
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};

  for (const key of ['label', 'description', 'sortOrder', 'status', 'isGlobal'] as const) {
    if (jsonStable(b[key]) === jsonStable(a[key])) {
      continue;
    }
    oldValue[key] = b[key];
    newValue[key] = a[key];
  }

  const vaB = b.valueAttributes as Record<string, unknown>;
  const vaA = a.valueAttributes as Record<string, unknown>;
  const vaD = valueAttributesOnlyDelta(vaB, vaA);
  if (vaD) {
    if (Object.keys(vaD.old).length) {
      oldValue.valueAttributes = vaD.old;
    }
    if (Object.keys(vaD.newAttrs).length) {
      newValue.valueAttributes = vaD.newAttrs;
    } else if (Object.keys(vaD.old).length) {
      newValue.valueAttributes = {};
    }
  }

  for (const { key, flat } of APPLIC_DIMS) {
    const arrB = before.applicability[key] as string[] | undefined;
    const arrA = after.applicability[key] as string[] | undefined;
    if (listEq(arrB, arrA)) {
      continue;
    }
    if (key === 'language' && (arrB?.length ?? 0) === 0 && (arrA?.length ?? 0) === 0) {
      continue;
    }
    oldValue[flat] = [...(arrB ?? [])];
    newValue[flat] = [...(arrA ?? [])];
  }

  if (b.metadataValueCode !== a.metadataValueCode) {
    oldValue.metadataValueCode = b.metadataValueCode;
    newValue.metadataValueCode = a.metadataValueCode;
  }

  return { oldValue, newValue };
}

/**
 * Resolves `UPDATE` vs `UPDATE_BREAKING` for value writes (separate from delta payload).
 */
export function resolveValueUpdateAction(
  metadataTypeCode: string,
  before: MetadataValueRecord,
  after: MetadataValueRecord,
): 'UPDATE' | 'UPDATE_BREAKING' {
  if (
    isMetadataValueStructureBreaking(metadataTypeCode, before.attributes, after.attributes) ||
    isApplicabilityRestricting(before.applicability, after.applicability)
  ) {
    return 'UPDATE_BREAKING';
  }
  return 'UPDATE';
}
