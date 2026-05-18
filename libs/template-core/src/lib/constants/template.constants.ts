export const TEMPLATE_META_SK = 'META' as const;
export const VERSION_SK_PREFIX = 'VERSION#' as const;

export const ENTITY_TYPE_MASTER_TEMPLATE = 'MASTER_TEMPLATE' as const;

export const GSI1_ORG_INDEX = 'GSI1' as const;
export const GSI2_TYPE_CATALOG = 'GSI2' as const;
export const GSI3_MASTER_VERSION = 'GSI3' as const;
export const GSI4_TEMPLATE_CODE = 'GSI4' as const;
export const GSI5_MASTER_STATUS = 'GSI5' as const;

export const ENV_TEMPLATE_TABLE = 'TEMPLATE_TABLE';

export const TEMPLATE_TYPE_CARE_PLAN = 'CARE_PLAN' as const;

export const TEMPLATE_STATUS = {
  DRAFT: 'DRAFT',
  SAVED: 'SAVED',
  IN_REVIEW: 'IN_REVIEW',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
  DEPRECATED: 'DEPRECATED',
} as const;

export type TemplateStatus = (typeof TEMPLATE_STATUS)[keyof typeof TEMPLATE_STATUS];
