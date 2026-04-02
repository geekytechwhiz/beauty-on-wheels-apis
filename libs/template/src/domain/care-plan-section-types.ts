/**
 * Stable section identifiers for CARE_PLAN templates (use sectionType or sectionId in config.sections[]).
 */
export const CarePlanSectionType = {
  OKR: 'OKR',
  REVIEW: 'REVIEW',
} as const;

export type CarePlanSectionTypeValue = (typeof CarePlanSectionType)[keyof typeof CarePlanSectionType];

export function resolveSectionKind(section: Record<string, unknown>): string | undefined {
  const t = section.sectionType ?? section.sectionId;
  if (typeof t === 'string' && t.trim() !== '') {
    return t.trim().toUpperCase();
  }
  return undefined;
}
