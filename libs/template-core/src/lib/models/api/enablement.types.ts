import type { DerivationKind } from '../../constants/template.constants';

export type CreateOrgEnablementBody = {
  organizationId: string;
  masterTemplateVersionId: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
};

export type CreateOrgEnablementParams = {
  body: CreateOrgEnablementBody;
  actorUserId?: string;
};

export type SearchOrgEnablementsParams = {
  organizationId?: string;
  masterTemplateVersionId?: string;
  nextToken?: string;
  limit?: number;
};

export type ListOrgEnablementsByOrgParams = {
  organizationId: string;
  organizationName?: string;
  organizationDescription?: string;
  limit?: number;
};

export type UpdateOrgEnablementBody = {
  action?: 'UPDATE' | 'REVOKE';
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
};

export type UpdateOrgEnablementParams = {
  enablementId: string;
  body: UpdateOrgEnablementBody;
  actorUserId?: string;
};

export interface OrgEnablementDto {
  enablementId: string;
  organizationId: string;
  masterTemplateId: string;
  masterTemplateVersionId: string;
  orgTemplateId: string;
  templateName?: string | null;
  templateType?: string | null;
  categoryCode?: string | null;
  conditionCode?: string | null;
  condition?: string | null;
  templateEnabled: boolean;
  effectiveFrom: string;
  effectiveTo?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface EnablementMeta {
  enablementId: string;
  organizationId: string;
  masterTemplateId: string;
  masterTemplateVersionId: string;
  /** Master `meta.version` at last derive/sync (e.g. 1.2 on same V01 row). */
  masterTemplateVersion?: number;
  orgTemplateId: string;
  /** Set on org-derived variant enablements so catalog list can skip them without extra reads. */
  derivationKind?: DerivationKind;
  templateName?: string;
  templateType?: string;
  categoryCode?: string;
  conditionCode?: string;
  condition?: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export type OrgEnablementListResult = {
  organizationMeta: {
    id: string;
    name: string;
    description: string | null;
  };
  items: OrgEnablementDto[];
  nextToken?: string;
};

export interface EnablementDdbRecord {
  pk: string;
  sk: string;
  entityType: 'ORG_ENABLEMENT';
  meta: EnablementMeta;
  gsi1pk?: string;
  gsi1sk?: string;
  gsi3pk?: string;
  gsi3sk?: string;
  gsi5pk?: string;
  gsi5sk?: string;
}
