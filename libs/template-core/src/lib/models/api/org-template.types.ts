import type { TemplateActorUser } from '../template-actor.model';
import type { TemplateStatus } from '../../constants/template.constants';
import type { VersionResolveStrategy } from './get-master-versions.types';
import type { EnablementDdbRecord } from './enablement.types';
import type { TemplateDdbRecord } from '../persistence/template-ddb.model';
import type { OrgTemplateListItem, TemplateVersionSummary } from '../../mappers/template-http.dto';

export type OrganizationMetaInput = {
  id: string;
  name: string;
  description: string;
};

export type CloneTemplateBody = {
  organizationMeta?: OrganizationMetaInput;
  /** Master template id from org catalog filter (templateName.value). */
  templateId?: string;
  /** Optional display name override (legacy org clone route only). */
  newTemplateName?: string;
  categoryCode?: string;
  conditionCode?: string;
  templateType?: string;
};

export type CloneOrgTemplateParams = {
  organizationId: string;
  /** Master template id from path (normalized templateCode). */
  masterTemplateId: string;
  /** Master templateVersionId or version id (V01). Omit to use latest PUBLISHED. */
  masterVersionId?: string;
  body?: CloneTemplateBody;
  actorUser?: TemplateActorUser;
};

export type SetOrgTemplateEnableParams = {
  organizationId: string;
  masterTemplateId: string;
  templateEnabled: boolean;
  organizationName?: string;
  organizationDescription?: string;
};

export type SetOrgTemplateEnableResult = {
  organizationMeta: {
    id: string;
    name: string;
    description?: string | null;
  };
  templateId: string;
  orgTemplateId: string;
  enablementId: string;
  templateEnabled: boolean;
  disabledAt?: string | null;
};

export type DeriveOrgTemplateResult = {
  record: TemplateDdbRecord;
  masterVersion: TemplateDdbRecord;
  enablement: EnablementDdbRecord;
  templateEnabled: boolean;
};

export type ListOrgTemplatesParams = {
  organizationId: string;
  organizationName?: string;
  organizationDescription?: string;
  condition?: string;
  status?: TemplateStatus;
  templateType?: string;
  specialty?: string;
  nextToken?: string;
};

export type ListOrgTemplatesResult = {
  organizationMeta: {
    id: string;
    name: string;
    description: string | null;
  };
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
};

export type GetOrgVersionsResult =
  | { mode: 'list'; items: TemplateVersionSummary[]; nextToken?: string }
  | { mode: 'single'; record: TemplateDdbRecord }
  | { mode: 'meta'; record: TemplateDdbRecord };
