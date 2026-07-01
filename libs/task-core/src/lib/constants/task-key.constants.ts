/**
 * Task-service key and business-id prefixes — single place to change wire/Dynamo segments.
 *
 * - `TASK_BUSINESS_ID_PREFIX` — correlation / entity ids (`rtask-…`, `rem-…`)
 * - `TASK_DDB_KEY_PREFIX` — DynamoDB PK/SK segment prefixes (`TASK#`, `DUE#`, …)
 */

/** Business id prefixes for runtime entities (camelCase segment after prefix). */
export const TASK_BUSINESS_ID_PREFIX = {
  RUNTIME_TASK: 'rtask-',
  REMINDER_RECORD: 'rem-',
  COMPLETION_EVIDENCE: 'evid-',
  EVIDENCE_SUMMARY: 'sum-',
} as const;

export type TaskBusinessIdPrefix =
  (typeof TASK_BUSINESS_ID_PREFIX)[keyof typeof TASK_BUSINESS_ID_PREFIX];

/** DynamoDB single-table key segment prefixes (UPPER per platform convention). */
export const TASK_DDB_KEY_PREFIX = {
  ORG: 'ORG#',
  PAT: 'PAT#',
  TASK: 'TASK#',
  DUE: 'DUE#',
  HIST: 'HIST#',
  EVID: 'EVID#',
  REM: 'REM#',
  CP: 'CP#',
  STAFF: 'STAFF#',
} as const;

export type TaskDdbKeyPrefix = (typeof TASK_DDB_KEY_PREFIX)[keyof typeof TASK_DDB_KEY_PREFIX];

/** Fixed sort keys and partition helpers derived from prefixes. */
export const TASK_DDB_SK = {
  LOOKUP: 'LOOKUP',
  REMINDER_CURRENT: `${TASK_DDB_KEY_PREFIX.REM}CURRENT`,
} as const;
