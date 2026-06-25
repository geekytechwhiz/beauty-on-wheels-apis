import type { OrganizationMeta } from './list-org-catalog.types';
import type { ListPagination } from './list-master.types';
import type { TemplateHistoryEntry } from '../../mappers/template-http.dto';
import type { TemplateActorUser } from '../template-actor.model';
import type { TemplateRulesPatch } from '../../utils/template-rules.utils';

export type OrgDerivedAdoptChangeRow = {
  key: string;
  label: string;
  message: string;
  before?: string;
  after?: string;
  preserved?: boolean;
  severity?: 'info' | 'warning';
  requiresReview?: boolean;
};

export type OrgDerivedAdoptChanges = {
  added: OrgDerivedAdoptChangeRow[];
  changed: OrgDerivedAdoptChangeRow[];
  removed: OrgDerivedAdoptChangeRow[];
};

export type OrgDerivedAdoptPreview = {
  available: boolean;
  title: string;
  fromVersion: number;
  fromVersionLabel: string;
  toVersion: number;
  toVersionLabel: string;
  sourceOrgTemplateId: string;
  fromOrgTemplateVersionId: string;
  toOrgTemplateVersionId: string;
  localChangesPresent: boolean;
  localChangesLabel: 'None' | 'Present';
  footerNote: string;
  changes: OrgDerivedAdoptChanges;
};

export type OrgDerivedCreateParams = {
  organizationId: string;
  sourceOrgTemplateId: string;
  newTemplateName: string;
  sourceVersionId?: string;
  templateEnabled?: boolean;
  organizationMeta?: OrganizationMeta;
  actorUser?: TemplateActorUser;
};

export type GetOrgDerivedVersionStatusParams = {
  organizationId: string;
  orgTemplateId: string;
  organizationName?: string;
  organizationDescription?: string;
};

export type OrgDerivedVersionStatusResult = {
  organizationMeta: OrganizationMeta;
  templateId: string;
  templateName: string;
  orgTemplateId: string;
  sourceOrgTemplateId: string;
  copiedFromOrgTemplateId?: string | null;
  currentVariantVersion: number;
  currentVariantVersionLabel: string;
  currentVariantTemplateVersionId: string;
  derivedFromOrgTemplateVersion: number;
  derivedFromOrgTemplateVersionLabel: string;
  derivedFromOrgTemplateVersionId: string;
  latestCanonicalOrgVersion: number;
  latestCanonicalOrgVersionLabel: string;
  latestCanonicalOrgTemplateVersionId: string;
  upgradeAvailable: boolean;
  upgradeStatus: 'AVAILABLE' | 'NONE';
  localChangesPresent: boolean;
  localChangesLabel: 'None' | 'Present';
  templateEnabled: boolean;
  enablementId: string;
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
  /** Always `DRAFT` on create. */
  status: string;
  /** Defaults to `true` on create. */
  active: boolean;
  /** Defaults to `true` when omitted in request. */
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
  derivedFromOrgTemplateVersionId?: string;
  derivedFromOrgTemplateVersion?: number;
  status: string;
  active: boolean;
  templateEnabled: boolean;
  /**
   * True when the canonical org template version is newer than the version this variant copied.
   * Same field name as `upgrade` on GET `/templates?templateLevel=ORG` (master → org derive).
   */
  upgrade: boolean;
  lastModifiedAt?: string;
  /** Variant version timeline (list mode only). */
  history?: TemplateHistoryEntry[];
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
  /** Populated when upgrade is true; otherwise null. */
  adopt: OrgDerivedAdoptPreview | null;
};

export type AdoptOrgDerivedParams = {
  organizationId: string;
  orgTemplateId: string;
  confirm?: boolean;
  preserveLocalOverrides?: boolean;
  actorUser?: TemplateActorUser;
};

export type AdoptOrgDerivedResult = {
  orgTemplateId: string;
  templateVersionId: string;
  templateName?: string;
  version: number;
  derivedFromOrgTemplateVersion: number;
  derivedFromOrgTemplateVersionId: string;
  status: string;
  active: boolean;
  templateEnabled: boolean;
  upgrade: boolean;
  adopt: null;
  fieldValues?: Record<string, unknown>;
  rules: Record<string, unknown>;
  history: TemplateHistoryEntry[];
};

export type UpdateOrgDerivedParams = {
  organizationId: string;
  orgTemplateId: string;
  rules?: TemplateRulesPatch;
  fieldValues?: Record<string, unknown>;
  templateEnabled?: boolean;
  /** `DRAFT` or `PUBLISHED` (`PUBLISH` accepted as alias). */
  status?: 'DRAFT' | 'PUBLISHED';
  /** Maps to template `isActive`. Defaults to `true` on create only. */
  active?: boolean;
  actorUser?: TemplateActorUser;
};

export type UpdateOrgDerivedResult = {
  orgTemplateId: string;
  templateVersionId: string;
  templateName?: string;
  version: number;
  status: string;
  active: boolean;
  templateEnabled: boolean;
  fieldValues?: Record<string, unknown>;
  rules: Record<string, unknown>;
};
