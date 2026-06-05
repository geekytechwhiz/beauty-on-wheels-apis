import type { OrganizationMeta } from './list-org-catalog.types';

export type GetOrgVersionStatusParams = {
  organizationId: string;
  masterTemplateId: string;
  organizationName?: string;
  organizationDescription?: string;
};

export type OrgVersionStatusResult = {
  organizationMeta: OrganizationMeta;
  templateId: string;
  templateName: string;
  orgTemplateId: string;
  currentOrgVersion: number;
  currentOrgVersionLabel: string;
  currentOrgTemplateVersionId: string;
  derivedFromMasterVersion: number;
  derivedFromMasterVersionLabel: string;
  derivedFromMasterVersionId: string;
  latestMasterVersion: number;
  latestMasterVersionLabel: string;
  latestMasterTemplateVersionId: string;
  upgradeAvailable: boolean;
  upgradeStatus: 'AVAILABLE' | 'NONE';
  localChangesPresent: boolean;
  localChangesLabel: 'None' | 'Present';
  enablementId: string;
};
