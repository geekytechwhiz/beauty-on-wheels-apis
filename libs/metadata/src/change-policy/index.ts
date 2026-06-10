import { aggregateChangeImpact } from './aggregator/impact-aggregator';
import { getChangePolicyCatalog } from './catalog/change-policy-catalog.loader';
import { detectFieldChanges } from './detector/change-detector';
import { matchPolicyRules } from './matcher/policy-matcher';
import type { AggregatedChangeImpact, ChangeImpactEvaluationInput, ChangePolicyCatalog } from './types/change-policy.types';
/**
 * Internal change-policy evaluation entry point (preview/publish orchestration only).
 * Does not expose ruleId or raw catalog via HTTP.
 */
export function evaluateChangeImpact(
  input: ChangeImpactEvaluationInput,
  catalog?: ChangePolicyCatalog,
): AggregatedChangeImpact {
  const activeCatalog = catalog ?? getChangePolicyCatalog();
  const changes = detectFieldChanges(input);
  const matches = matchPolicyRules(activeCatalog, changes);
  return aggregateChangeImpact(input, changes, matches);
}

export {
  loadChangePolicyCatalogFromFile,
  getChangePolicyCatalog,
  resetChangePolicyCatalogCache,
} from './catalog/change-policy-catalog.loader';
export { parseChangePolicyCatalog, ChangePolicyCatalogError } from './catalog/change-policy-catalog.schema';
export { detectFieldChanges } from './detector/change-detector';
export { matchPolicyRules } from './matcher/policy-matcher';
export { aggregateChangeImpact } from './aggregator/impact-aggregator';
export * from './types/change-policy.types';
export * from './types/policy-group.codes';