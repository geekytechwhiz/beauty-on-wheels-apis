import type { ListPagination } from './list-master.types';
import type { OrgDerivedAdoptPreview } from './org-derived.types';

export interface OrganizationMeta {
  id: string;
  name: string;
  active?: boolean;
  country?: string;
  updated?: string;
  description?: string | null;
}

export interface ListOrgEnabledParams {
  /** Omit for ROOT platform list of all orgs with enablements. */
  organizationId?: string;
  organizationName?: string;
  organizationDescription?: string;
  categoryCode?: string;
  condition?: string;
  conditionCode?: string;
  templateType?: string;
  templateName?: string;
  templateId?: string;
  /** Filter by enablement flag (`true` / `false`). Defaults to `true` (enabled only). */
  templateEnabled?: boolean;
  country?: string;
  nextToken?: string;
}

export interface OrgEnabledMasterSummary {
  templateId: string;
  templateVersionId: string;
  templateName?: string;
  templateType?: string;
  categoryCode?: string;
  conditionCode?: string;
  status: string;
  isActive: boolean;
  /** Latest published master display version (e.g. 1.2). */
  version?: number;
}

export interface OrgEnabledOrgSummary {
  templateId: string;
  templateVersionId: string;
  status: string;
  /** Canonical org template display version (e.g. 1.1 after local edits). */
  version?: number;
  /** Org template display version baseline (last adopt / derive). */
  derivedFromMasterVersion?: number;
  /** True when org template version is ahead of the stored baseline (after PUT rules). */
  upgrade: boolean;
  /** Populated when upgrade is true; otherwise null. */
  adopt: OrgDerivedAdoptPreview | null;
}

export interface OrgEnabledListItem {
  masterTemplate: OrgEnabledMasterSummary;
  orgTemplate: OrgEnabledOrgSummary;
  enablementId: string;
  enabledAt: string;
  /** Active enablement (false when disabled via `templateEnabled: false` update). */
  templateEnabled: boolean;
  disabledAt?: string | null;
  /**
   * True when the canonical org template version is ahead of its stored baseline
   * (same as orgTemplate.upgrade).
   */
  upgrade: boolean;
}

export interface OrgEnabledOrganizationGroup {
  organizationMeta: OrganizationMeta;
  items: OrgEnabledListItem[];
  counts: { total: number };
}

export interface OrgEnabledFilterOptions {
  conditionCode: string[];
  categoryCode: string[];
  templateType: string[];
  templateName: { key: string; value: string }[];
  /** Static country list for UI dropdowns. */
  country: string[];
}

export type ListOrgEnabledAllResult = {
  mode: 'all';
  organizations: OrgEnabledOrganizationGroup[];
  counts: {
    totalOrganizations: number;
    totalActiveOrganizations: number;
    totalInactiveOrganizations: number;
    totalEnabledTemplates: number;
  };
  filterOptions: OrgEnabledFilterOptions;
  pagination: ListPagination;
};

export type ListOrgEnabledSingleResult = {
  mode: 'single';
  organizationMeta: OrganizationMeta;
  items: OrgEnabledListItem[];
  counts: { total: number };
  filterOptions: OrgEnabledFilterOptions;
  pagination: ListPagination;
};

export type ListOrgEnabledResult = ListOrgEnabledAllResult | ListOrgEnabledSingleResult;

/** @deprecated Use ListOrgEnabledParams */
export type ListOrgCatalogParams = ListOrgEnabledParams & { organizationId: string };
