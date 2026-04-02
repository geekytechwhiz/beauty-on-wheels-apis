import type { EvaluationResult, RuleSet } from '@api-hub/rule-engine';
import type { TemplateLifecycleStatus } from './template-status';
import type { TemplateProfileDimensions } from './template-profile';

/** Canonical lifecycle (legacy draft/published/archived normalized on read). */
export type TemplateStatus = TemplateLifecycleStatus;

export type TemplateType = 'MASTER' | 'ORG';

export interface TemplateDocument {
  config: Record<string, unknown>;
  rules: RuleSet;
  actions: unknown;
}

export interface TemplateMetadata {
  templateId: string;
  orgId: string;
  version: string;
  type: TemplateType;
  status: TemplateStatus;
  baseTemplateId?: string;
  baseVersion?: string;
  baseOrgId?: string;
  /** Published master version id this ORG template was derived from (required for ORG). */
  masterTemplateVersionId?: string;
  schemaRef: string;
  /** Immutable document snapshot S3 key (same as schemaRef at publish or dedicated snapshot path). */
  snapshotRef?: string;
  /** Content hash of published document JSON. */
  snapshotId?: string;
  /** Profile dimensions for publish uniqueness within org. */
  profile?: TemplateProfileDimensions;
  /** Denormalized: buildProfileKey(orgId, profile). */
  profileKey?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  legacyInlineDocument?: TemplateDocument;
}

export interface TemplateDefinition {
  templateId: string;
  orgId: string;
  version: string;
  type?: TemplateType;
  schemaRef?: string;
  extendsTemplateId?: string;
  extendsVersion?: string;
  extendsBaseOrgId?: string;
  masterTemplateVersionId?: string;
  snapshotRef?: string;
  snapshotId?: string;
  profile?: TemplateProfileDimensions;
  profileKey?: string;
  config: Record<string, unknown>;
  rules: RuleSet;
  actions: unknown;
  status: TemplateStatus;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface TemplateResolutionStep {
  templateId: string;
  version: string;
}

export interface ResolvedTemplate {
  templateId: string;
  orgId: string;
  version: string;
  config: Record<string, unknown>;
  rules: RuleSet;
  actions: unknown;
  resolutionChain: TemplateResolutionStep[];
}

export type RuleEvaluationResult = EvaluationResult;

export interface TemplateExecutionResult {
  matched: boolean;
  actions: unknown;
  resolved: ResolvedTemplate;
  ruleEvaluation: RuleEvaluationResult;
}
