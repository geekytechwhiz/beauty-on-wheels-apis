import type { TemplateDefinition, TemplateDocument, TemplateStatus, TemplateType } from '../domain';

export interface CreateTemplateBody {
  templateId: string;
  version?: string;
  type: TemplateType;
  extendsTemplateId?: string;
  extendsVersion?: string;
  extendsBaseOrgId?: string;
  config: Record<string, unknown>;
  rules?: unknown;
  actions?: unknown;
  status: TemplateStatus;
  createdBy?: string;
}

export interface UpdateTemplateBody {
  version: string;
  extendsTemplateId?: string;
  extendsVersion?: string;
  extendsBaseOrgId?: string;
  config?: Record<string, unknown>;
  rules?: unknown;
  actions?: unknown;
  status?: TemplateStatus;
}

export interface ExecuteTemplateBody {
  context: Record<string, unknown>;
  version?: string;
}

export type TemplateDocumentLoader = (document: TemplateDocumentSource) => Promise<TemplateDocument>;

export interface TemplateDocumentSource {
  schemaRef?: string;
  legacyInlineDocument?: TemplateDocument;
}

export interface GetTemplateInput {
  orgId: string;
  templateId: string;
  version?: string;
}

export interface CreateTemplateInput {
  orgId: string;
  body: CreateTemplateBody;
}

export interface UpdateTemplateInput {
  orgId: string;
  templateId: string;
  body: UpdateTemplateBody;
}

export interface ExecuteTemplateInput {
  orgId: string;
  templateId: string;
  body: ExecuteTemplateBody;
}

export type TemplateReadResult = TemplateDefinition | null;
