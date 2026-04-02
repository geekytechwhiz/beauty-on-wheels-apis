import type { RuleSet } from './types';

/**
 * Concatenates global rules before template rules. {@link JsonRuleEngine} sorts by priority then id,
 * so lower priority numbers still run first regardless of which array they came from.
 */
export function mergeRuleSetsForEvaluation(globalRules: RuleSet, templateRules: RuleSet): RuleSet {
  if (globalRules.length === 0) {
    return templateRules;
  }
  return [...globalRules, ...templateRules];
}
