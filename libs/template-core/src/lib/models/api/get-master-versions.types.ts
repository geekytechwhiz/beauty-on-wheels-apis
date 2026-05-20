import type { TemplateStatus } from '../../constants/template.constants';
import type { TemplateVersionSummary } from '../../mappers/template-http.dto';
import type { TemplateDdbRecord } from '../persistence/template-ddb.model';

export type VersionResolveStrategy = 'ACTIVE' | 'LATEST_PUBLISHED' | 'LATEST_ANY';

export type ListMasterVersionsParams = {
  templateId: string;
  status?: TemplateStatus;
  nextToken?: string;
  limit?: number;
};

export type GetMasterVersionsParams = ListMasterVersionsParams & {
  version?: string;
  resolve?: VersionResolveStrategy;
};

export type ListMasterVersionsResult = {
  mode: 'list';
  items: TemplateVersionSummary[];
  nextToken?: string;
};

export type SingleMasterVersionResult = {
  mode: 'single';
  record: TemplateDdbRecord;
};

export type GetMasterVersionsResult = ListMasterVersionsResult | SingleMasterVersionResult;
