import type { TemplateStatus } from '../../constants/template.constants';
import type { VersionResolveStrategy } from './get-master-versions.types';
import type { TemplateDdbRecord } from '../persistence/template-ddb.model';
import type { OrgTemplateListItem, TemplateVersionSummary } from '../../mappers/template-http.dto';

export type CloneTemplateBody = {
  newTemplateName?: string;
  inheritLinks?: boolean;
};

export type CloneOrgTemplateParams = {
  organizationId: string;
  masterTemplateId: string;
  masterVersionId: string;
  body?: CloneTemplateBody;
  actorUserId?: string;
};

export type ListOrgTemplatesParams = {
  organizationId: string;
  condition?: string;
  status?: TemplateStatus;
  templateType?: string;
  specialty?: string;
  nextToken?: string;
  limit?: number;
};

export type ListOrgTemplatesResult = {
  items: OrgTemplateListItem[];
  nextToken?: string;
};

export type GetOrgVersionsParams = {
  organizationId: string;
  templateId: string;
  version?: string;
  resolve?: VersionResolveStrategy;
  status?: TemplateStatus;
  nextToken?: string;
  limit?: number;
};

export type GetOrgVersionsResult =
  | { mode: 'list'; items: TemplateVersionSummary[]; nextToken?: string }
  | { mode: 'single'; record: TemplateDdbRecord }
  | { mode: 'meta'; record: TemplateDdbRecord };
