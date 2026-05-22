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

export interface OrgEnablementDto {
  enablementId: string;
  organizationId: string;
  masterTemplateVersionId: string;
  templateName?: string | null;
  condition?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  createdAt: string;
}

export interface EnablementMeta {
  enablementId: string;
  organizationId: string;
  masterTemplateVersionId: string;
  templateName?: string;
  condition?: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  createdAt: string;
  [key: string]: unknown;
}

export interface EnablementDdbRecord {
  pk: string;
  sk: string;
  entityType: 'ORG_ENABLEMENT';
  meta: EnablementMeta;
  gsi1pk?: string;
  gsi1sk?: string;
  gsi3pk?: string;
  gsi3sk?: string;
}
