import type { TemplateStatus } from '../../constants/template.constants';
import type { ShareScope } from '../../constants/template.constants';
import type { MasterTemplateListItem } from '../../mappers/template-http.dto';

export interface ListMasterTemplatesParams {
  category?: string;
  condition?: string;
  /** Alias for `condition` used by the dashboard filter. */
  conditionCode?: string;
  country?: string;
  status?: TemplateStatus;
  shareScope?: ShareScope;
  templateType?: string;
  language?: string;
  specialty?: string;
  templateCode?: string;
  /** Match master `templateId` (exact) or `templateName` (partial, case-insensitive). */
  templateName?: string;
  /** Filter by resolved `isActive` (stored flag or status default). */
  active?: boolean;
  nextToken?: string;
}

export interface ListPagination {
  limit: number;
  /** Items returned in the current page. */
  count: number;
  /** Total items matching the active filters (across all pages). */
  total: number;
  nextToken?: string;
  hasMore: boolean;
}

/** `active`/`inactive` from stored `isActive` (published may be inactive). `draft`/`published` by lifecycle status. */
export interface ListStatusCounts {
  total: number;
  active: number;
  inactive: number;
  draft: number;
  published: number;
}

export interface FilterOption {
  label: string;
  value: string;
}

export interface ListFilterOptions {
  status: FilterOption[];
  scope: FilterOption[];
  condition: FilterOption[];
}

export interface ListMasterTemplatesResult {
  items: MasterTemplateListItem[];
  pagination: ListPagination;
  counts: ListStatusCounts;
  filterOptions: ListFilterOptions;
}
