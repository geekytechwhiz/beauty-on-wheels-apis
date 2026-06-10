/** Governed policy groups from addendum §4.2. */
export const POLICY_GROUP = {
  IDENTITY_IMMUTABLE: 'IDENTITY_IMMUTABLE',
  DISPLAY_ONLY: 'DISPLAY_ONLY',
  AVAILABILITY_STATUS: 'AVAILABILITY_STATUS',
  APPLICABILITY_SCOPE: 'APPLICABILITY_SCOPE',
  STRUCTURED_BEHAVIOR: 'STRUCTURED_BEHAVIOR',
  CLINICAL_INTERPRETATION: 'CLINICAL_INTERPRETATION',
  EXPANDABLE_OPTION: 'EXPANDABLE_OPTION',
  FIXED_TEMPLATE_VALUE: 'FIXED_TEMPLATE_VALUE',
  RUNTIME_PINNED: 'RUNTIME_PINNED',
} as const;

export type PolicyGroupCode = (typeof POLICY_GROUP)[keyof typeof POLICY_GROUP];

export const POLICY_GROUP_CODES = Object.values(POLICY_GROUP);

export const VERSION_IMPACT = {
  DESCRIPTIVE: 'Descriptive',
  ADDITIVE: 'Additive',
  BREAKING: 'Breaking',
} as const;

export type VersionImpact = (typeof VERSION_IMPACT)[keyof typeof VERSION_IMPACT];

export const VERSION_IMPACT_CODES = Object.values(VERSION_IMPACT);

export const RUNTIME_IMPACT = {
  NONE: 'None',
  DISPLAY_ONLY: 'DisplayOnly',
  REVIEW_REQUIRED: 'ReviewRequired',
  MIGRATION_REQUIRED: 'MigrationRequired',
} as const;

export type RuntimeImpact = (typeof RUNTIME_IMPACT)[keyof typeof RUNTIME_IMPACT];

export const RUNTIME_IMPACT_CODES = Object.values(RUNTIME_IMPACT);

export const MERGE_BEHAVIOR = {
  SILENT_DISPLAY_REFRESH: 'SilentDisplayRefresh',
  ADD_ONLY: 'AddOnly',
  PRESERVE_ORG_OVERRIDE: 'PreserveOrgOverride',
  MANUAL_REVIEW: 'ManualReview',
  BLOCK: 'Block',
} as const;

export type MergeBehavior = (typeof MERGE_BEHAVIOR)[keyof typeof MERGE_BEHAVIOR];

export const MERGE_BEHAVIOR_CODES = Object.values(MERGE_BEHAVIOR);

export const CHANGE_POLICY_OPERATION = {
  ADD: 'Add',
  UPDATE: 'Update',
  INACTIVATE: 'Inactivate',
  RETIRE: 'Retire',
  PUBLISH: 'Publish',
} as const;

export type ChangePolicyOperation = (typeof CHANGE_POLICY_OPERATION)[keyof typeof CHANGE_POLICY_OPERATION];

export const CHANGE_POLICY_OPERATION_CODES = Object.values(CHANGE_POLICY_OPERATION);

/** Applicability list mutations — expand vs restrict drive different rules (addendum §4.4.2). */
export const APPLICABILITY_CHANGE_KIND = {
  EXPAND: 'Expand',
  RESTRICT: 'Restrict',
  ANY: 'Any',
} as const;

export type ApplicabilityChangeKind = (typeof APPLICABILITY_CHANGE_KIND)[keyof typeof APPLICABILITY_CHANGE_KIND];

export const APPLICABILITY_CHANGE_KIND_CODES = Object.values(APPLICABILITY_CHANGE_KIND);
