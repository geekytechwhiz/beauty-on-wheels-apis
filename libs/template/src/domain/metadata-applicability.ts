import type {
  MetadataApplicabilityContext,
  MetadataDefinition,
} from './metadata-definition.types';

function matchesDimension(allowed: string[], ctxValue: string): boolean {
  if (allowed.length === 0) {
    return true;
  }
  return allowed.includes(ctxValue);
}

/**
 * True when the definition applies to the given profile/config context.
 * Empty applicability arrays on the definition mean "any" for that dimension.
 */
export function isMetadataApplicable(
  metadata: MetadataDefinition,
  context: MetadataApplicabilityContext,
): boolean {
  const a = metadata.applicability;
  return (
    matchesDimension(a.templateType, context.templateType) &&
    matchesDimension(a.category, context.category) &&
    matchesDimension(a.condition, context.condition) &&
    matchesDimension(a.country, context.country)
  );
}
