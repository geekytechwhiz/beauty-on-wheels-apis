import type { ApplicabilityContext, MetadataValue } from './types';

/**
 * Checks whether a dimension value is present in the value's dimension array.
 * Only called when the caller explicitly provides the dimension.
 */
function dimAllows(requestValue: string, valueDim: string[]): boolean {
  return valueDim.length === 0 || valueDim.includes(requestValue);
}

/**
 * Applicability is stored at Metadata Value level as per design;
 * no separate METADATA_APPL entity required.
 *
 * Filtering follows an optional model:
 *  - Only provided context dimensions are checked.
 *  - Omitted dimensions are not filtered (skip, not "GLOBAL").
 *  - isGlobal=true always passes regardless of context.
 */
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
  if (ctx.module && !dimAllows(ctx.module, value.applicableModules)) return false;
  if (ctx.category && !dimAllows(ctx.category, value.applicableCategories)) return false;
  if (ctx.condition && !dimAllows(ctx.condition, value.applicableConditions)) return false;
  if (ctx.country && !dimAllows(ctx.country, value.applicableCountries)) return false;
  return true;
}
