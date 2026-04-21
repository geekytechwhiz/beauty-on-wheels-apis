import type { Applicability } from './types';
import { applDimensionPartitionKey } from './keys';

/** API / request dimension names (lowercase). */
export const APPLICABILITY_API_DIMENSIONS = ['country', 'module', 'category', 'condition', 'language'] as const;
export type ApplicabilityApiDimension = (typeof APPLICABILITY_API_DIMENSIONS)[number];

const API_TO_SEGMENT: Record<ApplicabilityApiDimension, string> = {
  country: 'COUNTRY',
  module: 'MODULE',
  category: 'CATEGORY',
  condition: 'CONDITION',
  language: 'LANGUAGE',
};

export function isApplicabilityApiDimension(value: unknown): value is ApplicabilityApiDimension {
  return (
    typeof value === 'string' &&
    (APPLICABILITY_API_DIMENSIONS as readonly string[]).includes(value.trim().toLowerCase())
  );
}

export function normalizeApplicabilityApiDimension(raw: unknown): ApplicabilityApiDimension | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const s = String(raw).trim().toLowerCase();
  if ((APPLICABILITY_API_DIMENSIONS as readonly string[]).includes(s)) {
    return s as ApplicabilityApiDimension;
  }
  return null;
}

export function apiDimensionToSegment(d: ApplicabilityApiDimension): string {
  return API_TO_SEGMENT[d];
}

/** Tokens from one applicability payload for aggregated dimension index (deduped per PK+SK). */
export function collectApplicabilityDimensionIndexKeys(a: Applicability): { pk: string; sk: string }[] {
  const pairs: { pk: string; sk: string }[] = [];

  const push = (dim: ApplicabilityApiDimension, tokens: string[] | undefined) => {
    const pk = applDimensionPartitionKey(apiDimensionToSegment(dim));
    for (const raw of tokens ?? []) {
      const t = String(raw).trim();
      if (t.length === 0 || t === '*') {
        continue;
      }
      pairs.push({ pk, sk: t });
    }
  };

  push('country', a.country);
  push('module', a.module);
  push('category', a.category);
  push('condition', a.condition);
  push('language', a.language);

  const seen = new Set<string>();
  const out: { pk: string; sk: string }[] = [];
  for (const p of pairs) {
    const k = `${p.pk}\0${p.sk}`;
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(p);
  }
  return out;
}
