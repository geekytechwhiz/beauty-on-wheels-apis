import type { RuleSet } from '@api-hub/rule-engine';
import type { TemplateDefinition, TemplateDocument, TemplateStatus, TemplateType } from '../domain';
import type { TemplateProfileDimensions } from '../domain/template-profile';

export interface CreateTemplateBody {
  templateId: string;
  version?: string;
  type: TemplateType;
  extendsTemplateId?: string;
  extendsVersion?: string;
  extendsBaseOrgId?: string;
  /** Required for publish uniqueness; should be set before publish. */
  profile?: TemplateProfileDimensions;
  config: Record<string, unknown>;
  rules?: RuleSet;
  actions?: unknown;
  status?: TemplateStatus;
  createdBy?: string;
}

export interface UpdateTemplateBody {
  version: string;
  extendsTemplateId?: string;
  extendsVersion?: string;
  extendsBaseOrgId?: string;
  profile?: TemplateProfileDimensions;
  config?: Record<string, unknown>;
  rules?: RuleSet;
  actions?: unknown;
  status?: TemplateStatus;
}

export interface ExecuteTemplateBody {
  context: Record<string, unknown>;
  version?: string;
}

export interface PublishTemplateBody {
  version: string;
}

export type TemplateDocumentLoader = (document: TemplateDocumentSource) => Promise<TemplateDocument>;

export interface TemplateDocumentSource {
  schemaRef?: string;
  /** Immutable snapshot key for published templates (preferred over schemaRef for execution). */
  snapshotRef?: string;
  legacyInlineDocument?: TemplateDocument;
}

/** Default `published` (safe for linking/execution alignment). Use `raw` for authoring (latest or version-specific draft). */
export type GetTemplateView = 'published' | 'raw';

export interface GetTemplateInput {
  orgId: string;
  templateId: string;
  version?: string;
  /** Defaults to `published`. */
  view?: GetTemplateView;
}

export interface CreateTemplateInput {
  orgId: string;
  body: CreateTemplateBody;
  idempotencyKey?: string;
}

export interface UpdateTemplateInput {
  orgId: string;
  templateId: string;
  body: UpdateTemplateBody;
  idempotencyKey?: string;
}

export interface ExecuteTemplateInput {
  orgId: string;
  templateId: string;
  body: ExecuteTemplateBody;
}

export interface PublishTemplateInput {
  orgId: string;
  templateId: string;
  body: PublishTemplateBody;
  idempotencyKey?: string;
}

export type TemplateReadResult = TemplateDefinition | null;
