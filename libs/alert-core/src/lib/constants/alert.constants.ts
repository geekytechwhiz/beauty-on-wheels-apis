/** Single-table sort keys and entity markers */
export const ALERT_METADATA_SK = 'METADATA' as const;

export const ACTIVITY_SK_PREFIX = 'ACTIVITY#' as const;

export const ENTITY_TYPE_ALERT = 'ALERT' as const;
export const ENTITY_TYPE_ACTIVITY = 'ACTIVITY' as const;

export const GSI1_ORG_QUEUE = 'GSI1' as const;
export const GSI2_USER_QUEUE = 'GSI2' as const;
export const GSI3_PATIENT = 'GSI3' as const;
export const GSI4_GROUP = 'GSI4' as const;
export const GSI5_SLA = 'GSI5' as const;

/** Order: EVENT, ALERT, ACTIVITY, GROUP */
export const TRANSACT_INDEX_EVENT = 0;
export const TRANSACT_INDEX_GROUP = 3;

export const ENV_ALERT_TABLE = 'ALERT_TABLE';
export const ENV_ASSIGN_SLA_MINUTES = 'ALERT_DEFAULT_ASSIGN_SLA_MINUTES';
export const ENV_RESOLVE_SLA_MINUTES = 'ALERT_DEFAULT_RESOLVE_SLA_MINUTES';

export const DEFAULT_ASSIGN_SLA_MINUTES = 60;
export const DEFAULT_RESOLVE_SLA_MINUTES = 240;

export const ACTIVITY_TYPE_ALERT_CREATED = 'ALERT_CREATED' as const;

export const ACTOR_SYSTEM = 'SYSTEM' as const;
