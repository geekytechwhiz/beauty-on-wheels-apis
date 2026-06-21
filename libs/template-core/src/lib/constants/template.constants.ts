export const TEMPLATE_META_SK = 'META';
export const VERSION_SK_PREFIX = 'VERSION#';

export const ENTITY_TYPE_MASTER_TEMPLATE = 'MASTER_TEMPLATE';
export const ENTITY_TYPE_ORG_TEMPLATE = 'ORG_TEMPLATE';

export const ORG_TMPL_PK_PREFIX = 'ORG_TMPL#';
export const GSI1_ORG_PK_PREFIX = 'ORG#';
export const GSI1_ORG_TMPL_SK_PREFIX = 'TMPL#';
export const GSI1_ENABLE_SK_PREFIX = 'ENABLE#';

export const ENTITY_TYPE_ORG_ENABLEMENT = 'ORG_ENABLEMENT';
export const ENTITY_TYPE_ORG_PROFILE = 'ORG_PROFILE';
export const ORG_PROFILE_SK = 'PROFILE';
export const ENABLE_PK_PREFIX = 'ENABLE#';

export const GSI1_ORG_INDEX = 'GSI1';
export const GSI2_TYPE_CATALOG = 'GSI2';
export const GSI3_MASTER_VERSION = 'GSI3';
export const GSI4_TEMPLATE_CODE = 'GSI4';
export const GSI5_MASTER_STATUS = 'GSI5';

export const ENV_TEMPLATE_TABLE = 'TEMPLATE_TABLE';

/** Default page size for template list APIs (not overridable via query). */
export const DEFAULT_TEMPLATE_LIST_PAGE_SIZE = 20;

export const TEMPLATE_TYPE_CARE_PLAN = 'CARE_PLAN';

/** Prefix for legacy CARE_PLAN fieldValues keys that store linked templates. */
export const LINKED_TEMPLATE_FIELD_KEY_PREFIX = 'LINKED_';

/** Console UI keys → legacy catalog names (rules use the key stored in fieldValues). */
export const LINKED_TEMPLATE_CONSOLE_KEYS = {
  LinkedTaskTemplate: 'LINKED_TASK_TEMPLATE',
  LinkedGoalTemplate: 'LINKED_GOAL_TEMPLATE',
  LinkedMonitoringTemplate: 'LINKED_MONITORING_TEMPLATE',
} as const;

const CONSOLE_LINKED_TEMPLATE_FIELD_KEYS = new Set(Object.keys(LINKED_TEMPLATE_CONSOLE_KEYS));

export function isLinkedTemplateFieldKey(key: string): boolean {
  return key.startsWith(LINKED_TEMPLATE_FIELD_KEY_PREFIX) || CONSOLE_LINKED_TEMPLATE_FIELD_KEYS.has(key);
}

export const LINKED_TEMPLATE_MAX_LINKS = 20;
export const LINKED_TEMPLATE_NESTED_ARRAY_MAX = 10;

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

/** Org template VERSION rows editable via fieldValues/rules PUT. */
export const ORG_EDITABLE_STATUSES: TemplateStatus[] = [
  TEMPLATE_STATUS.DRAFT,
  TEMPLATE_STATUS.SAVED,
  TEMPLATE_STATUS.IN_REVIEW,
];

export const STATUS_TRANSITION_ACTION = {
  SUBMIT_REVIEW: 'SUBMIT_REVIEW',
  PUBLISH: 'PUBLISH',
  REJECT: 'REJECT',
  ARCHIVE: 'ARCHIVE',
  DEPRECATE: 'DEPRECATE',
} as const;

export type StatusTransitionAction =
  (typeof STATUS_TRANSITION_ACTION)[keyof typeof STATUS_TRANSITION_ACTION];
