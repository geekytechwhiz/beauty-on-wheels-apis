import type { ChangeRequestOperation } from './change-request.types';
import type {
  PolicyGroupCode,
  RuntimeImpact,
  MergeBehavior,
  ChangePolicyOperation,
} from '../change-policy/types/policy-group.codes';

export interface ImpactPreviewChangedField {
  objectPath: string;
  operation: ChangePolicyOperation;
  oldValue: unknown;
  newValue: unknown;
  policyGroup: PolicyGroupCode;
}

export interface ImpactPreviewSummary {
  policyGroups: PolicyGroupCode[];
  versionImpact: string;
  requiresMetadataVersion: boolean;
  requiresTemplateAdoption: boolean;
  requiresOrgCapabilityReevaluation: boolean;
  runtimeImpact: RuntimeImpact;
  mergeBehavior: MergeBehavior;
  uxDiffRequired: boolean;
}

/** POST `?action=impact-preview` response — no ruleId or catalog exposure. */
export interface ImpactPreviewResponse {
  entityType: 'type' | 'value';
  operation: ChangeRequestOperation;
  metadataTypeCode: string;
  metadataValueCode?: string | null;
  changeRequestId?: string | null;
  baseVersion: number | null;
  nextVersion: number | null;
  changedFields: ImpactPreviewChangedField[];
  impactSummary: ImpactPreviewSummary;
  confirmationRequired: boolean;
  affectedConsumers: string[];
}
