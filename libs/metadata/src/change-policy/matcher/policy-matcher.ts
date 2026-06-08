import type { ChangePolicyCatalog, DetectedFieldChange, MatchedPolicyRule } from '../types/change-policy.types';
import { APPLICABILITY_CHANGE_KIND } from '../types/policy-group.codes';

function changeKindMatches(ruleKind: string | undefined, detectedKind: string): boolean {
  if (!ruleKind || ruleKind === APPLICABILITY_CHANGE_KIND.ANY) {
    return true;
  }
  return ruleKind === detectedKind;
}

/**
 * Matches detected field changes to catalog rules by objectPath + operation + changeKind.
 * Falls back to generic paths (e.g. MetadataValue.ValueAttributes) when type-specific rule absent.
 */
export function matchPolicyRules(
  catalog: ChangePolicyCatalog,
  changes: DetectedFieldChange[],
): MatchedPolicyRule[] {
  const matches: MatchedPolicyRule[] = [];

  for (const change of changes) {
    const candidates = catalog.rules.filter(
      (rule) =>
        rule.objectPath === change.objectPath &&
        rule.operation === change.operation &&
        changeKindMatches(rule.changeKind, change.changeKind),
    );

    if (candidates.length === 0) {
      const fallback = findFallbackRule(catalog, change);
      if (fallback) {
        matches.push({ rule: fallback, change });
      }
      continue;
    }

    for (const rule of candidates) {
      matches.push({ rule, change });
    }
  }

  return matches;
}

function findFallbackRule(
  catalog: ChangePolicyCatalog,
  change: DetectedFieldChange,
): (typeof catalog.rules)[number] | undefined {
  if (change.objectPath.startsWith('MetricCode.ValueAttributes.')) {
    return catalog.rules.find(
      (r) => r.objectPath === 'MetadataValue.ValueAttributes' && r.operation === change.operation,
    );
  }
  if (change.objectPath.startsWith('QuestionCode.ValueAttributes.')) {
    return catalog.rules.find(
      (r) => r.objectPath === 'MetadataValue.ValueAttributes' && r.operation === change.operation,
    );
  }
  return undefined;
}
