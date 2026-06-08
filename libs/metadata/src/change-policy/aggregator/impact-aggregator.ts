import type {
  AggregatedChangeImpact,
  ChangeImpactEvaluationInput,
  DetectedFieldChange,
  MatchedPolicyRule,
} from '../types/change-policy.types';
import {
  MERGE_BEHAVIOR,
  RUNTIME_IMPACT,
  VERSION_IMPACT,
  type MergeBehavior,
  type PolicyGroupCode,
  type RuntimeImpact,
  type VersionImpact,
} from '../types/policy-group.codes';

const VERSION_IMPACT_RANK: Record<VersionImpact, number> = {
  [VERSION_IMPACT.DESCRIPTIVE]: 0,
  [VERSION_IMPACT.ADDITIVE]: 1,
  [VERSION_IMPACT.BREAKING]: 2,
};

const RUNTIME_IMPACT_RANK: Record<RuntimeImpact, number> = {
  [RUNTIME_IMPACT.NONE]: 0,
  [RUNTIME_IMPACT.DISPLAY_ONLY]: 1,
  [RUNTIME_IMPACT.REVIEW_REQUIRED]: 2,
  [RUNTIME_IMPACT.MIGRATION_REQUIRED]: 3,
};

const MERGE_BEHAVIOR_RANK: Record<MergeBehavior, number> = {
  [MERGE_BEHAVIOR.SILENT_DISPLAY_REFRESH]: 0,
  [MERGE_BEHAVIOR.ADD_ONLY]: 1,
  [MERGE_BEHAVIOR.PRESERVE_ORG_OVERRIDE]: 2,
  [MERGE_BEHAVIOR.MANUAL_REVIEW]: 3,
  [MERGE_BEHAVIOR.BLOCK]: 4,
};

function maxVersionImpact(current: VersionImpact, next: VersionImpact): VersionImpact {
  return VERSION_IMPACT_RANK[next] > VERSION_IMPACT_RANK[current] ? next : current;
}

function maxRuntimeImpact(current: RuntimeImpact, next: RuntimeImpact): RuntimeImpact {
  return RUNTIME_IMPACT_RANK[next] > RUNTIME_IMPACT_RANK[current] ? next : current;
}

function maxMergeBehavior(current: MergeBehavior, next: MergeBehavior): MergeBehavior {
  return MERGE_BEHAVIOR_RANK[next] > MERGE_BEHAVIOR_RANK[current] ? next : current;
}

function emptyImpact(input: ChangeImpactEvaluationInput, changes: DetectedFieldChange[]): AggregatedChangeImpact {
  return {
    entityType: input.entityType,
    metadataTypeCode: input.metadataTypeCode,
    metadataValueCode: input.metadataValueCode,
    workflowOperation: input.workflowOperation,
    changedObjectPaths: changes.map((c) => c.objectPath),
    changes,
    policyGroups: [],
    versionImpact: VERSION_IMPACT.DESCRIPTIVE,
    requiresMetadataVersion: false,
    requiresTemplateAdoption: false,
    requiresOrgCapabilityReevaluation: false,
    runtimeImpact: RUNTIME_IMPACT.NONE,
    mergeBehavior: MERGE_BEHAVIOR.SILENT_DISPLAY_REFRESH,
    uxDiffRequired: false,
  };
}

/** Merges matched rules into a single impact summary (no ruleId exposure). */
export function aggregateChangeImpact(
  input: ChangeImpactEvaluationInput,
  changes: DetectedFieldChange[],
  matches: MatchedPolicyRule[],
): AggregatedChangeImpact {
  if (matches.length === 0) {
    return emptyImpact(input, changes);
  }

  let versionImpact: VersionImpact = VERSION_IMPACT.DESCRIPTIVE;
  let runtimeImpact: RuntimeImpact = RUNTIME_IMPACT.NONE;
  let mergeBehavior: MergeBehavior = MERGE_BEHAVIOR.SILENT_DISPLAY_REFRESH;
  let requiresMetadataVersion = false;
  let requiresTemplateAdoption = false;
  let requiresOrgCapabilityReevaluation = false;
  let uxDiffRequired = false;
  const policyGroups = new Set<PolicyGroupCode>();

  for (const { rule } of matches) {
    policyGroups.add(rule.policyGroup);
    versionImpact = maxVersionImpact(versionImpact, rule.versionImpact);
    runtimeImpact = maxRuntimeImpact(runtimeImpact, rule.runtimeImpact);
    mergeBehavior = maxMergeBehavior(mergeBehavior, rule.mergeBehavior);
    requiresMetadataVersion = requiresMetadataVersion || rule.requiresMetadataVersion;
    requiresTemplateAdoption = requiresTemplateAdoption || rule.requiresTemplateAdoption;
    requiresOrgCapabilityReevaluation =
      requiresOrgCapabilityReevaluation || rule.requiresOrgCapabilityReevaluation;
    uxDiffRequired = uxDiffRequired || rule.uxDiffRequired;
  }

  return {
    entityType: input.entityType,
    metadataTypeCode: input.metadataTypeCode,
    metadataValueCode: input.metadataValueCode,
    workflowOperation: input.workflowOperation,
    changedObjectPaths: [...new Set(changes.map((c) => c.objectPath))],
    changes,
    policyGroups: [...policyGroups],
    versionImpact,
    requiresMetadataVersion,
    requiresTemplateAdoption,
    requiresOrgCapabilityReevaluation,
    runtimeImpact,
    mergeBehavior,
    uxDiffRequired,
  };
}
