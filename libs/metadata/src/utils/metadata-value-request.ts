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

function hasAnyApplicabilityToken(a: Applicability): boolean {
  const dims: (keyof Applicability)[] = ['module', 'category', 'condition', 'country'];
  for (const d of dims) {
    if ((a[d] ?? []).length > 0) {
      return true;
    }
  }
  return (a.language ?? []).length > 0;
}

/**
 * Requirements: global → no scoped tokens; non-global → at least one dimension has a token.
 */
export function validateMetadataValueApplicabilityRules(isGlobal: boolean, applicability: Applicability): void {
  const any = hasAnyApplicabilityToken(applicability);
  if (isGlobal) {
    if (any) {
      throw new ValidationError('When isGlobal is true, applicableModules, applicableCategories, applicableConditions, applicableCountries, and applicableLanguages must be empty or omitted', [
        { field: 'applicability', message: 'Must be empty when isGlobal is true' },
      ]);
    }
    return;
  }
  if (!any) {
    throw new ValidationError('When isGlobal is false, at least one applicability list must contain a value', [
      { field: 'applicability', message: 'At least one of module, category, condition, country, or language is required' },
    ]);
  }
}
