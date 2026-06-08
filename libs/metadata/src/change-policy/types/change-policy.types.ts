import type {
  ApplicabilityChangeKind,
  ChangePolicyOperation,
  MergeBehavior,
  PolicyGroupCode,
  RuntimeImpact,
  VersionImpact,
} from './policy-group.codes';

/** Internal catalog row (seed / migration). Not exposed via public API. */
export interface ChangePolicyRule {
  /** Stable internal identifier for catalog maintenance only. */
  ruleId: string;
  objectPath: string;
  operation: ChangePolicyOperation;
  /**
   * When set, rule applies only to applicability/token-list expand or restrict mutations.
   * Omit or `Any` for fields where direction does not matter.
   */
  changeKind?: ApplicabilityChangeKind;
  policyGroup: PolicyGroupCode;
  versionImpact: VersionImpact;
  requiresMetadataVersion: boolean;
  requiresTemplateAdoption: boolean;
  requiresOrgCapabilityReevaluation: boolean;
  runtimeImpact: RuntimeImpact;
  canAutoApplyToPublishedCarePlan: boolean;
  canAutoApplyToActiveRuntime: boolean;
  mergeBehavior: MergeBehavior;
  uxDiffRequired: boolean;
  notes?: string;
}

export interface ChangePolicyCatalog {
  version: string;
  rules: ChangePolicyRule[];
}

/** One detected field-level mutation before policy matching. */
export interface DetectedFieldChange {
  objectPath: string;
  operation: ChangePolicyOperation;
  changeKind: ApplicabilityChangeKind;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface ChangeImpactEvaluationInput {
  entityType: 'type' | 'value';
  metadataTypeCode: string;
  metadataValueCode?: string;
  /** Top-level workflow operation derived from draft/publish context. */
  workflowOperation: ChangePolicyOperation;
  basePayload: Record<string, unknown> | null;
  proposedPayload: Record<string, unknown>;
}

/** Matched rule applied to a detected change (internal). */
export interface MatchedPolicyRule {
  rule: ChangePolicyRule;
  change: DetectedFieldChange;
}

/** Aggregated impact summary — safe for preview/publish orchestration (no ruleId). */
export interface AggregatedChangeImpact {
  entityType: 'type' | 'value';
  metadataTypeCode: string;
  metadataValueCode?: string;
  workflowOperation: ChangePolicyOperation;
  changedObjectPaths: string[];
  changes: DetectedFieldChange[];
  policyGroups: PolicyGroupCode[];
  versionImpact: VersionImpact;
  requiresMetadataVersion: boolean;
  requiresTemplateAdoption: boolean;
  requiresOrgCapabilityReevaluation: boolean;
  runtimeImpact: RuntimeImpact;
  mergeBehavior: MergeBehavior;
  uxDiffRequired: boolean;
}
