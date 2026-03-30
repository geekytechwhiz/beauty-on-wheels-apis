export type TemplateStatus = 'draft' | 'published' | 'archived';

export type TemplateType = 'MASTER' | 'ORG';

export interface TemplateDocument {
  config: Record<string, unknown>;
  rules: unknown;
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
  schemaRef: string;
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
  config: Record<string, unknown>;
  rules: unknown;
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
  rules: unknown;
  actions: unknown;
  resolutionChain: TemplateResolutionStep[];
}

export interface RuleEvaluationResult {
  matched: boolean;
  trace?: unknown;
}

export interface TemplateExecutionResult {
  matched: boolean;
  actions: unknown;
  resolved: ResolvedTemplate;
  ruleEvaluation: RuleEvaluationResult;
}
