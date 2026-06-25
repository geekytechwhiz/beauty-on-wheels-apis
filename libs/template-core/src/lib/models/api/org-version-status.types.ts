import type { OrganizationMeta } from './list-org-catalog.types';

export type GetOrgVersionStatusParams = {
  organizationId: string;
  masterTemplateId?: string;
  orgTemplateId?: string;
  organizationName?: string;
  organizationDescription?: string;
};

export type OrgVersionStatusResult = {
  organizationMeta: OrganizationMeta;
  templateId: string;
  templateName: string;
  orgTemplateId: string;
  currentOrgVersion?: number;
  currentOrgVersionLabel?: string;
  currentOrgTemplateVersionId?: string;
  derivedFromMasterVersion?: number;
  derivedFromMasterVersionLabel?: string;
  derivedFromMasterVersionId?: string;
  latestMasterVersion?: number;
  latestMasterVersionLabel?: string;
  latestMasterTemplateVersionId?: string;
  upgradeAvailable: boolean;
  upgradeStatus: 'AVAILABLE' | 'NONE';
  localChangesPresent: boolean;
  localChangesLabel: 'None' | 'Present';
  enablementId: string;
  sourceOrgTemplateId?: string;
  copiedFromOrgTemplateId?: string | null;
  currentVariantVersion?: number;
  currentVariantVersionLabel?: string;
  currentVariantTemplateVersionId?: string;
  derivedFromOrgTemplateVersion?: number;
  derivedFromOrgTemplateVersionLabel?: string;
  derivedFromOrgTemplateVersionId?: string;
  latestCanonicalOrgVersion?: number;
  latestCanonicalOrgVersionLabel?: string;
  latestCanonicalOrgTemplateVersionId?: string;
  templateEnabled?: boolean;
};
