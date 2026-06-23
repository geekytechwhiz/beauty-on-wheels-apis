import type { OrganizationMeta } from './list-org-catalog.types';
import type { ListPagination } from './list-master.types';
import type { TemplateActorUser } from '../template-actor.model';
import type { TemplateRulesPatch } from '../../utils/template-rules.utils';

export type OrgDerivedCreateParams = {
  organizationId: string;
  sourceOrgTemplateId: string;
  newTemplateName: string;
  sourceVersionId?: string;
  templateEnabled?: boolean;
  organizationMeta?: OrganizationMeta;
  actorUser?: TemplateActorUser;
};

export type OrgDerivedCreateResult = {
  organizationId: string;
  sourceOrgTemplateId: string;
  orgTemplateId: string;
  templateVersionId: string;
  templateName: string;
  masterTemplateId?: string;
  templateType?: string;
  categoryCode?: string;
  conditionCode?: string;
  templateEnabled: boolean;
  version: number;
};

export type ListOrgDerivedParams = {
  organizationId: string;
  orgTemplateId?: string;
  categoryCode?: string;
  conditionCode?: string;
  condition?: string;
  specialty?: string;
  templateType?: string;
  templateName?: string;
  templateEnabled?: boolean;
  nextToken?: string;
};

export type OrgDerivedFilterOption = {
  key: string;
  label: string;
};

export type OrgDerivedFilterOptions = {
  categoryCode: OrgDerivedFilterOption[];
  conditionCode: OrgDerivedFilterOption[];
  specialty: OrgDerivedFilterOption[];
};

export type OrgDerivedListItem = {
  orgTemplateId: string;
  templateName?: string;
  templateType?: string;
  masterTemplateId?: string;
  categoryCode?: string;
  conditionCode?: string;
  specialty?: string[];
  version: number;
  templateVersionId: string;
  derivedFromOrgTemplateId?: string;
  templateEnabled: boolean;
  lastModifiedAt?: string;
};

export type ListOrgDerivedResult = {
  organizationMeta: OrganizationMeta;
  items: OrgDerivedListItem[];
  filterOptions: OrgDerivedFilterOptions;
  pagination: ListPagination;
};

export type GetOrgDerivedResult = OrgDerivedListItem & {
  organizationId: string;
  derivedFromOrgTemplateVersionId?: string;
  fieldValues?: Record<string, unknown>;
  rules: Record<string, unknown>;
};

export type UpdateOrgDerivedParams = {
  organizationId: string;
  orgTemplateId: string;
  rules?: TemplateRulesPatch;
  fieldValues?: Record<string, unknown>;
  templateEnabled?: boolean;
  actorUser?: TemplateActorUser;
};

export type UpdateOrgDerivedResult = {
  orgTemplateId: string;
  templateVersionId: string;
  templateName?: string;
  version: number;
  templateEnabled: boolean;
  fieldValues?: Record<string, unknown>;
  rules: Record<string, unknown>;
};
