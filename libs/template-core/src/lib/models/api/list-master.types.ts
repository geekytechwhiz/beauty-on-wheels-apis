import type { TemplateStatus } from '../../constants/template.constants';
import type { MasterTemplateListItem } from '../../mappers/template-http.dto';

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
  items: MasterTemplateListItem[];
  nextToken?: string;
}
