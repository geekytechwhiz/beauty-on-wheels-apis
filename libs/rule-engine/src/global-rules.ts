import { loadRuleSet } from './loader';
import type { RuleSet } from './types';

type GlobalRulesDoc = { rules: unknown };

/**
 * Loads the canonical global rule document from `libs/rules/global/rules.json`.
 * Resolved at bundle time when using esbuild (JSON is included in the output).
 */
export function getDefaultGlobalRules(): RuleSet {
  // Path from libs/rule-engine/src → libs/rules/global/rules.json
   
  const doc = require('../../rules/global/rules.json') as GlobalRulesDoc;
  return loadRuleSet(doc.rules);
}
