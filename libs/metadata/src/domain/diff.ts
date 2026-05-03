import type { Applicability, MetadataTypeInput } from '../models/types';

/**
 * Breaking type change: valueDataType, multiSelect, applicable modules, or non-compatible
 * attributeSchema changes require a new version. Display name / description only can update in place.
 */
export function isMetadataTypeBreakingChange(before: MetadataTypeInput, after: MetadataTypeInput): boolean {
  if (onlyDisplayNameOrDescriptionChanged(before, after)) {
    return false;
  }
  if (before.status !== after.status) {
    return true;
  }

  if (after.valueDataType !== undefined && before.valueDataType !== undefined && after.valueDataType !== before.valueDataType) {
    return true;
  }
  if (after.valueDataType !== undefined && before.valueDataType === undefined) {
    return true;
  }
  if (
    after.multiSelectAllowed !== undefined &&
    before.multiSelectAllowed !== undefined &&
    after.multiSelectAllowed !== before.multiSelectAllowed
  ) {
    return true;
  }
  const befMods = stableStringify((before.applicableModules ?? []).slice().sort());
  const aftMods = stableStringify((after.applicableModules ?? []).slice().sort());
  if (befMods !== aftMods) {
    return true;
  }

  const b = before.attributeSchema ?? {};
  const a = after.attributeSchema ?? {};
  if (stableStringify(b) === stableStringify(a)) {
    return false;
  }
  return !isAttributeSchemaCompatibleExtension(b, a);
}

/** True if `after` only adds keys or keeps the same values for keys present in `before`. */
export function isAttributeSchemaCompatibleExtension(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  for (const k of Object.keys(before)) {
    if (!(k in after)) {
      return false;
    }
    if (stableStringify((after as Record<string, unknown>)[k]) !== stableStringify(before[k])) {
      return false;
    }
  }
  return true;
}

/**
 * `after` is expected to be the merged full state (e.g. update merge), not a partial patch.
 * True when the only differences are displayName and/or description.
 */
function onlyDisplayNameOrDescriptionChanged(before: MetadataTypeInput, after: MetadataTypeInput): boolean {
  const structuralBefore = {
    metadataTypeCode: before.metadataTypeCode,
    valueDataType: before.valueDataType,
    multiSelectAllowed: before.multiSelectAllowed,
    applicableModules: before.applicableModules,
    valueApplicabilityConfig: before.valueApplicabilityConfig,
    attributeSchema: before.attributeSchema,
    status: before.status,
  };
  const structuralAfter = {
    metadataTypeCode: after.metadataTypeCode,
    valueDataType: after.valueDataType,
    multiSelectAllowed: after.multiSelectAllowed,
    applicableModules: after.applicableModules,
    valueApplicabilityConfig: after.valueApplicabilityConfig,
    attributeSchema: after.attributeSchema,
    status: after.status,
  };
  if (stableStringify(structuralBefore) !== stableStringify(structuralAfter)) {
    return false;
  }
  return before.displayName !== after.displayName || before.description !== after.description;
}

function stableStringify(v: unknown): string {
  if (v === undefined) {
    return '';
  }
  return JSON.stringify(sortKeysDeep(v));
}

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

/** A previously allowed applicability token was removed → restricts future use → new version. */
export function isApplicabilityRestricting(before: Applicability, after: Applicability): boolean {
  const dims: (keyof Applicability)[] = ['module', 'category', 'condition', 'country'];
  for (const d of dims) {
    const b = before[d] ?? [];
    const a = after[d] ?? [];
    const setA = new Set(a);
    if (b.some((t) => !setA.has(t))) {
      return true;
    }
  }
  const langB = before.language ?? [];
  const langA = after.language ?? [];
  const setLangA = new Set(langA);
  if (langB.some((t) => !setLangA.has(t))) {
    return true;
  }
  return false;
}

const METRIC_STRUCTURE_KEYS = [
  'dataType',
  'unit',
  'supportedSourceTypes',
  'supportedEvaluationLogic',
  'directionality',
  'decimalAllowed',
  'minSupportedValue',
  'maxSupportedValue',
] as const;

const QUESTION_STRUCTURE_KEYS = ['questionType', 'answerScale', 'thresholdEligible'] as const;

/**
 * Whether updating value `attributes` requires a new metadata value version (structured / behavioral change).
 */
export function isMetadataValueStructureBreaking(
  metadataTypeCode: string,
  beforeAttrs: Record<string, unknown> | undefined,
  afterAttrs: Record<string, unknown> | undefined,
): boolean {
  const b = beforeAttrs ?? {};
  const a = afterAttrs ?? {};

  if (metadataTypeCode === 'MetricCode') {
    return METRIC_STRUCTURE_KEYS.some((k) => stableStringify(b[k]) !== stableStringify(a[k]));
  }

  if (metadataTypeCode === 'QuestionCode') {
    const structural = QUESTION_STRUCTURE_KEYS.some((k) => stableStringify(b[k]) !== stableStringify(a[k]));
    if (structural) {
      return true;
    }
    // questionText: wording-only updates do not require a new version
    return false;
  }

  if (stableStringify(b) === stableStringify(a)) {
    return false;
  }
  return !isAttributeSchemaCompatibleExtension(b, a);
}

/** @deprecated Use {@link isMetadataValueStructureBreaking} */
export function isMetadataValueAttributesBreaking(
  beforeAttrs: Record<string, unknown> | undefined,
  afterAttrs: Record<string, unknown> | undefined,
): boolean {
  return stableStringify(beforeAttrs) !== stableStringify(afterAttrs);
}
