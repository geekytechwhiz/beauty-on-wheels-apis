import { GLOBAL_DIMENSION } from './constants';
import type { ApplicabilityContext, MetadataValue } from './types';

/**
 * Expands applicability dimensions into a Cartesian product of tuples for APPL# rows.
 * Empty arrays are treated as [GLOBAL] unless isGlobal forces a single GLOBAL tuple.
 */
export function expandApplicabilityTuples(input: {
  isGlobal: boolean;
  applicableModules: string[];
  applicableCategories: string[];
  applicableConditions: string[];
  applicableCountries: string[];
}): Array<[string, string, string, string]> {
  if (input.isGlobal) {
    return [
      [
        GLOBAL_DIMENSION,
        GLOBAL_DIMENSION,
        GLOBAL_DIMENSION,
        GLOBAL_DIMENSION,
      ],
    ];
  }

  const M =
    input.applicableModules.length > 0 ? input.applicableModules : [GLOBAL_DIMENSION];
  const C =
    input.applicableCategories.length > 0 ? input.applicableCategories : [GLOBAL_DIMENSION];
  const Co =
    input.applicableConditions.length > 0 ? input.applicableConditions : [GLOBAL_DIMENSION];
  const Cu =
    input.applicableCountries.length > 0 ? input.applicableCountries : [GLOBAL_DIMENSION];

  const out: Array<[string, string, string, string]> = [];
  for (const m of M) {
    for (const c of C) {
      for (const co of Co) {
        for (const cu of Cu) {
          out.push([m, c, co, cu]);
        }
      }
    }
  }
  return out;
}

function dimAllows(requestValue: string, valueDim: string[]): boolean {
  return valueDim.includes(GLOBAL_DIMENSION) || valueDim.includes(requestValue);
}

/** Used for list-by-context: coarse filter on VALUE entities. */
export function valueAppliesToContext(
  value: Pick<
    MetadataValue,
    | 'status'
    | 'isGlobal'
    | 'applicableModules'
    | 'applicableCategories'
    | 'applicableConditions'
    | 'applicableCountries'
  >,
  ctx: ApplicabilityContext,
): boolean {
  if (value.status !== 'ACTIVE') {
    return false;
  }
  if (value.isGlobal) {
    return true;
  }
  return (
    dimAllows(ctx.module, value.applicableModules) &&
    dimAllows(ctx.category, value.applicableCategories) &&
    dimAllows(ctx.condition, value.applicableConditions) &&
    dimAllows(ctx.country, value.applicableCountries)
  );
}

/** Priority-ordered SK candidates for APPL lookups (validateMetadataValue). */
export function applicabilityLookupCandidates(
  ctx: ApplicabilityContext,
): ApplicabilityContext[] {
  const { module, category, condition, country } = ctx;
  return [
    { module, category, condition, country },
    { module, category, condition, country: GLOBAL_DIMENSION },
    { module, category, condition: GLOBAL_DIMENSION, country },
    { module, category: GLOBAL_DIMENSION, condition, country },
  ];
}
