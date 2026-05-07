import type { RuleSet } from '../types';
import { assertValidRuleSet } from '../validation';

export function loadRuleSet(input: unknown): RuleSet {
  assertValidRuleSet(input);
  return [...input];
}

export function loadRuleSetFromJson(json: string): RuleSet {
  const parsed = JSON.parse(json) as unknown;
  return loadRuleSet(parsed);
}
