import type { Applicability } from '../domain/types';
import { ValidationError } from '../domain/errors';

/** Flat API field names (Figma) → nested applicability keys. */
const FLAT_TO_NESTED: { flat: string; dim: keyof Applicability }[] = [
  { flat: 'applicableModules', dim: 'module' },
  { flat: 'applicableCategories', dim: 'category' },
  { flat: 'applicableConditions', dim: 'condition' },
  { flat: 'applicableCountries', dim: 'country' },
  { flat: 'applicableLanguages', dim: 'language' },
];

function hasOwn(o: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

const APPLICABILITY_BODY_KEYS = [
  'applicability',
  'applicableModules',
  'applicableCategories',
  'applicableConditions',
  'applicableCountries',
  'applicableLanguages',
] as const;

/** True if the request explicitly sets applicability (nested or flat Figma fields). */
export function applicabilityKeysPresentInBody(body: Record<string, unknown>): boolean {
  for (const k of APPLICABILITY_BODY_KEYS) {
    if (hasOwn(body, k)) {
      return true;
    }
  }
  return false;
}

/**
 * Trim, uppercase, dedupe (first occurrence wins order), drop empties.
 */
export function normalizeApplicabilityTokens(raw: string[] | undefined | null): string[] {
  if (!raw?.length) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const t = String(item).trim().toUpperCase();
    if (!t || seen.has(t)) {
      continue;
    }
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Merge nested `applicability` with flat Figma fields. For each dimension, if a flat key is present on `body`,
 * its normalized value wins; otherwise nested values are normalized; else `[]`.
 */
export function mapFlatAndNestedToApplicability(
  body: Record<string, unknown>,
  nested?: Applicability,
): Applicability {
  const base = nested ?? {
    module: [],
    category: [],
    condition: [],
    country: [],
  };
  const out: Applicability = {
    module: [],
    category: [],
    condition: [],
    country: [],
  };

  for (const { flat, dim } of FLAT_TO_NESTED) {
    const assign = (vals: string[]): void => {
      if (dim === 'module') {
        out.module = vals;
      } else if (dim === 'category') {
        out.category = vals;
      } else if (dim === 'condition') {
        out.condition = vals;
      } else if (dim === 'country') {
        out.country = vals;
      } else {
        out.language = vals;
      }
    };

    if (hasOwn(body, flat)) {
      const raw = body[flat];
      if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
        throw new ValidationError(`Invalid ${flat}`, [{ field: flat, message: 'Must be an array of strings' }]);
      }
      assign(normalizeApplicabilityTokens(raw as string[] | undefined));
    } else {
      const fromNested = base[dim] as string[] | undefined;
      assign(normalizeApplicabilityTokens(fromNested));
    }
  }
  return out;
}

const VALUE_SCOPE_DIMS: (keyof Applicability)[] = ['module', 'category', 'condition', 'country'];

/**
 * Global rule: if `isGlobal` is true, applicability lists may be empty. If `isGlobal` is false, at least one of
 * module / category / condition / country must have a value (language alone does not satisfy scope).
 */
export function validateMetadataValueApplicabilityRules(isGlobal: boolean, applicability: Applicability): void {
  if (isGlobal) {
    return;
  }
  const anyScope = VALUE_SCOPE_DIMS.some((d) => (applicability[d] ?? []).length > 0);
  if (!anyScope) {
    throw new ValidationError('When isGlobal is false, at least one of module, category, condition, or country must be set', [
      { field: 'applicability', message: 'At least one scope dimension is required' },
    ]);
  }
}
