import type { ListPagination } from './list-master.types';

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
  /** Filter by enablement flag (`true` / `false`). Omit to return both. */
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
}

export interface OrgEnabledOrgSummary {
  templateId: string;
  templateVersionId: string;
  status: string;
}

export interface OrgEnabledListItem {
  masterTemplate: OrgEnabledMasterSummary;
  orgTemplate: OrgEnabledOrgSummary;
  enablementId: string;
  enabledAt: string;
  /** Active enablement (false when disabled via `templateEnabled: false` update). */
  templateEnabled: boolean;
  disabledAt?: string | null;
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
