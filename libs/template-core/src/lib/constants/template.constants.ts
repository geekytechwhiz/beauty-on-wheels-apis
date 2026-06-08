export const TEMPLATE_META_SK = 'META' as const;
export const VERSION_SK_PREFIX = 'VERSION#' as const;

export const ENTITY_TYPE_MASTER_TEMPLATE = 'MASTER_TEMPLATE' as const;
export const ENTITY_TYPE_ORG_TEMPLATE = 'ORG_TEMPLATE' as const;

export const ORG_TMPL_PK_PREFIX = 'ORG_TMPL#' as const;
export const GSI1_ORG_PK_PREFIX = 'ORG#' as const;
export const GSI1_ORG_TMPL_SK_PREFIX = 'TMPL#' as const;
export const GSI1_ENABLE_SK_PREFIX = 'ENABLE#' as const;

export const ENTITY_TYPE_ORG_ENABLEMENT = 'ORG_ENABLEMENT' as const;
export const ENTITY_TYPE_ORG_PROFILE = 'ORG_PROFILE' as const;
export const ORG_PROFILE_SK = 'PROFILE' as const;
export const ENABLE_PK_PREFIX = 'ENABLE#' as const;

export const GSI1_ORG_INDEX = 'GSI1' as const;
export const GSI2_TYPE_CATALOG = 'GSI2' as const;
export const GSI3_MASTER_VERSION = 'GSI3' as const;
export const GSI4_TEMPLATE_CODE = 'GSI4' as const;
export const GSI5_MASTER_STATUS = 'GSI5' as const;

export const ENV_TEMPLATE_TABLE = 'TEMPLATE_TABLE';

/** Default page size for template list APIs (not overridable via query). */
export const DEFAULT_TEMPLATE_LIST_PAGE_SIZE = 20;

export const TEMPLATE_TYPE_CARE_PLAN = 'CARE_PLAN' as const;

/** Template types queried on GSI2 for published master catalog / org enablement filterOptions. */
export const MASTER_CATALOG_TEMPLATE_TYPES = [
  'ALERT',
  'ALERT_POLICY',
  'CARE_PLAN',
  'GOAL',
  'MONITORING',
  'SYMPTOM',
  'TASK',
  'THRESHOLD',
] as const;

/** Visibility for master templates (API accepts Private | Organization | Public). */
export const SHARE_SCOPE = {
  PRIVATE: 'PRIVATE',
  ORGANIZATION: 'ORGANIZATION',
  PUBLIC: 'PUBLIC',
} as const;

export type ShareScope = (typeof SHARE_SCOPE)[keyof typeof SHARE_SCOPE];

export const TEMPLATE_STATUS = {
  DRAFT: 'DRAFT',
  SAVED: 'SAVED',
  IN_REVIEW: 'IN_REVIEW',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
  DEPRECATED: 'DEPRECATED',
} as const;

export type TemplateStatus = (typeof TEMPLATE_STATUS)[keyof typeof TEMPLATE_STATUS];

/** Master templates: only DRAFT and PUBLISHED (API + edits). */
export const MASTER_SIMPLE_STATUSES: TemplateStatus[] = [
  TEMPLATE_STATUS.DRAFT,
  TEMPLATE_STATUS.PUBLISHED,
];

/** Master VERSION rows with these statuses may be updated via POST /templates/{id}. */
export const MASTER_EDITABLE_STATUSES: TemplateStatus[] = [...MASTER_SIMPLE_STATUSES];

export const STATUS_TRANSITION_ACTION = {
  SUBMIT_REVIEW: 'SUBMIT_REVIEW',
  PUBLISH: 'PUBLISH',
  REJECT: 'REJECT',
  ARCHIVE: 'ARCHIVE',
  DEPRECATE: 'DEPRECATE',
} as const;

export type StatusTransitionAction =
  (typeof STATUS_TRANSITION_ACTION)[keyof typeof STATUS_TRANSITION_ACTION];
