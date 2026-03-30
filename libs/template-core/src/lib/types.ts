export type TemplateStatus = 'draft' | 'published' | 'archived';

export type TemplateType = 'MASTER' | 'ORG';

/**
 * Payload stored in S3 as JSON (rules, actions, config — not in DynamoDB).
 */
export interface TemplateDocument {
  config: Record<string, unknown>;
  rules: unknown;
  actions: unknown;
}

/**
 * Metadata row only (DynamoDB). Full content is at {@link TemplateMetadata.schemaRef}.
 */
export interface TemplateMetadata {
  templateId: string;
  orgId: string;
  version: string;
  type: TemplateType;
  status: TemplateStatus;
  /** Inheritance: child → base */
  baseTemplateId?: string;
  baseVersion?: string;
  /** When base lives in another partition (e.g. {@link TEMPLATE_MASTER_ORG_ID}). */
  baseOrgId?: string;
  /** S3 object key within the template bucket */
  schemaRef: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  /**
   * Set when reading legacy rows that still embed JSON in DynamoDB.
   * Callers should migrate to S3 and persist schemaRef only.
   */
  legacyInlineDocument?: TemplateDocument;
}

/**
 * Full template (API + execution): metadata merged with S3 document.
 * API compatibility: `extendsTemplateId` / `extendsVersion` mirror base* fields.
 */
export interface TemplateDefinition {
  templateId: string;
  orgId: string;
  version: string;
  type?: TemplateType;
  /** S3 key; omitted for unsaved drafts only */
  schemaRef?: string;
  extendsTemplateId?: string;
  extendsVersion?: string;
  /** When inheritance points at another org partition (e.g. MASTER catalog). */
  extendsBaseOrgId?: string;
  config: Record<string, unknown>;
  rules: unknown;
  actions: unknown;
  status: TemplateStatus;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

/**
 * Result of resolving inheritance (base → child overlays).
 */
export interface ResolvedTemplate {
  templateId: string;
  orgId: string;
  version: string;
  config: Record<string, unknown>;
  rules: unknown;
  actions: unknown;
  resolutionChain: TemplateResolutionStep[];
}

export interface TemplateResolutionStep {
  templateId: string;
  version: string;
}

/**
 * Outcome of executing a template against runtime context.
 */
export interface TemplateExecutionResult {
  matched: boolean;
  /** Materialized actions when rules matched; otherwise null */
  actions: unknown;
  resolved: ResolvedTemplate;
  ruleEvaluation: RuleEvaluationResult;
}

/** Summary from the rule engine (kept in core to avoid circular deps). */
export interface RuleEvaluationResult {
  matched: boolean;
  trace?: unknown;
}
