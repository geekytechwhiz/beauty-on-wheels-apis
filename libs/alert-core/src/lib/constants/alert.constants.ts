/** Single-table sort keys and entity markers */
export const ALERT_METADATA_SK = 'METADATA' as const;

export const ACTIVITY_SK_PREFIX = 'ACTIVITY#' as const;

export const ENTITY_TYPE_ALERT = 'ALERT' as const;
export const ENTITY_TYPE_ACTIVITY = 'ACTIVITY' as const;

export const GSI1_ORG_QUEUE = 'GSI1' as const;
export const GSI2_USER_QUEUE = 'GSI2' as const;
export const GSI3_PATIENT = 'GSI3' as const;
export const GSI4_ORG_WIDE = 'GSI4' as const;
export const GSI5_SLA = 'GSI5' as const;

/** Transact item index for conditional idempotency EVENT Put failures. */
export const TRANSACT_INDEX_EVENT = 0;

/** Base-table `GROUP#` partition: membership rows use `sk` beginning with this prefix. */
export const GROUP_MEMBERSHIP_SK_PREFIX = 'Alert#' as const;

export const ENV_ALERT_TABLE = 'ALERT_TABLE';
export const ENV_ASSIGN_SLA_MINUTES = 'ALERT_DEFAULT_ASSIGN_SLA_MINUTES';
export const ENV_RESOLVE_SLA_MINUTES = 'ALERT_DEFAULT_RESOLVE_SLA_MINUTES';

export const DEFAULT_ASSIGN_SLA_MINUTES = 60;
export const DEFAULT_RESOLVE_SLA_MINUTES = 240;

export const ACTIVITY_TYPE_ALERT_CREATED = 'ALERT_CREATED' as const;
export const ACTIVITY_TYPE_NOTE_ADDED = 'NOTE_ADDED' as const;

export const ACTOR_SYSTEM = 'SYSTEM' as const;
