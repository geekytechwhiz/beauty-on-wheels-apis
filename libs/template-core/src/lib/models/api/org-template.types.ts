import type { TemplateStatus } from '../../constants/template.constants';
import type { VersionResolveStrategy } from './get-master-versions.types';
import type { TemplateDdbRecord } from '../persistence/template-ddb.model';
import type { OrgTemplateListItem, TemplateVersionSummary } from '../../mappers/template-http.dto';

export type CloneTemplateBody = {
  newTemplateName?: string;
  /** Selected master display name from enable UI. */
  templateName?: string;
  inheritLinks?: boolean;
  derivationType?: 'ENABLE' | 'CLONE';
};

export type CloneOrgTemplateParams = {
  organizationId: string;
  /** Master template id from path (normalized templateCode). */
  masterTemplateId: string;
  /** Master templateVersionId or version id (V01). Omit to use latest PUBLISHED. */
  masterVersionId?: string;
  body?: CloneTemplateBody;
  actorUserId?: string;
};

export type DeriveOrgTemplateResult = {
  record: TemplateDdbRecord;
  masterVersion: TemplateDdbRecord;
  templateEnabled: boolean;
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
