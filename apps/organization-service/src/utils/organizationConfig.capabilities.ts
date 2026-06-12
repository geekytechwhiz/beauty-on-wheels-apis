import type { OrganizationConfigData } from '../models';

const normalizeCode = (value: string): string => value.trim().toUpperCase();

export interface CategoryConditionPair {
  categoryCode: string;
  conditionCode: string;
}

/**
 * Builds deterministic org capability IDs from validated Category→Condition pairs.
 * Format: `CAP-{CATEGORY}__{CONDITION}` (TLH-12120).
 */
export function buildOrgCapabilities(pairs: CategoryConditionPair[]): string[] {
  const capabilities = new Set<string>();
  for (const { categoryCode, conditionCode } of pairs) {
    const category = normalizeCode(categoryCode);
    const condition = normalizeCode(conditionCode);
    if (!category || !condition) continue;
    capabilities.add(`CAP-${category}__${condition}`);
  }
  return [...capabilities].sort();
}

/**
 * Derives Category→Condition pairs used for capability generation from org config
 * and registry relation groups (Category BELONGS_TO_CATEGORY Condition).
 */
export function deriveCategoryConditionPairs(
  config: OrganizationConfigData,
  conditionsByCategory: Map<string, Set<string>>,
): CategoryConditionPair[] {
  const enabledCategories = (config.enabledCategoryCodes ?? []).map(normalizeCode);
  const enabledConditions = new Set((config.enabledConditionCodes ?? []).map(normalizeCode));
  const pairs: CategoryConditionPair[] = [];

  for (const categoryCode of enabledCategories) {
    const relatedConditions = conditionsByCategory.get(categoryCode) ?? new Set<string>();
    for (const conditionCode of relatedConditions) {
      if (enabledConditions.has(conditionCode)) {
        pairs.push({ categoryCode, conditionCode });
      }
    }
  }

  pairs.sort((left, right) => {
    const categoryCompare = left.categoryCode.localeCompare(right.categoryCode);
    if (categoryCompare !== 0) return categoryCompare;
    return left.conditionCode.localeCompare(right.conditionCode);
  });

  return pairs;
}
