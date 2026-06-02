import type { TemplateStatus } from '../../constants/template.constants';

export interface ListMasterTemplatesParams {
  category?: string;
  condition?: string;
  country?: string;
  status?: TemplateStatus;
  templateType?: string;
  language?: string;
  specialty?: string;
  templateCode?: string;
  limit?: number;
  nextToken?: string;
}

export interface ListMasterTemplatesResult {
  /** Full VERSION document per template (payload shape as stored). */
  items: Record<string, unknown>[];
  nextToken?: string;
}
