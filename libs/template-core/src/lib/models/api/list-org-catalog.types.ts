import type { MasterTemplateListItem, TemplateHistoryEntry } from '../../mappers/template-http.dto';
import type { ListFilterOptions, ListPagination } from './list-master.types';

export interface ListOrgCatalogParams {
  organizationId: string;
  categoryCode?: string;
  condition?: string;
  conditionCode?: string;
  templateType?: string;
  /** Filter by master template name (partial match). */
  templateName?: string;
  country?: string;
  status?: string;
  limit?: number;
  nextToken?: string;
}

export interface OrgEnableCatalogItem extends MasterTemplateListItem {
  categoryCode?: string;
  conditionCode?: string;
  /** True when this master version is already enabled for the org. */
  templateEnabled: boolean;
  countries?: string[];
  history?: TemplateHistoryEntry[];
}

export interface OrgCatalogCounts {
  total: number;
  active: number;
  inactive: number;
  templateEnabled: number;
}

export interface OrgCatalogFilterOptions extends ListFilterOptions {
  category: { label: string; value: string }[];
  templateType: { label: string; value: string }[];
  templateName: { label: string; value: string }[];
  country: { label: string; value: string }[];
}

export interface ListOrgCatalogResult {
  items: OrgEnableCatalogItem[];
  pagination: ListPagination;
  counts: OrgCatalogCounts;
  filterOptions: OrgCatalogFilterOptions;
}
