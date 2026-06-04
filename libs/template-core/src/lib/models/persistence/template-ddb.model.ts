import type { TemplateStatus } from '../../constants/template.constants';
import type { TemplateActorUser } from '../template-actor.model';

export interface TemplateMeta {
  templateId: string;
  templateVersionId: string;
  templateCode?: string;
  templateName?: string;
  templateType?: string;
  templateDescription?: string;
  category?: string | string[];
  condition?: string | string[];
  conditions?: string[];
  countries?: string[];
  languages?: string[];
  specialty?: string[];
  version?: number;
  status?: TemplateStatus;
  isActive?: boolean;
  isLatestVersion?: boolean;
  publishedAt?: string | null;
  createdAt?: string;
  lastModifiedAt?: string;
  createdBy?: string | TemplateActorUser;
  lastModifiedBy?: string | TemplateActorUser;
  publishedBy?: string | TemplateActorUser | null;
  [key: string]: unknown;
}

export interface TemplateDdbRecord {
  pk: string;
  sk: string;
  entityType: 'MASTER_TEMPLATE' | 'ORG_TEMPLATE';

  meta: TemplateMeta;

  gsi1pk?: string;
  gsi1sk?: string;
  gsi2pk?: string;
  gsi2sk?: string;
  gsi3pk?: string;
  gsi3sk?: string;
  gsi4pk?: string;
  gsi4sk?: string;
  gsi5pk?: string;
  gsi5sk?: string;

  schemaRef?: string | null;
  schemaHash?: string | null;
  schemaSize?: number | null;

  carePlanAttributes?: Record<string, unknown>;
  sharedComponents?: Record<string, unknown>;
  links?: Record<string, unknown>;
  steps?: unknown[];
  templateTypeConfig?: Record<string, unknown>;

  [key: string]: unknown;
}
