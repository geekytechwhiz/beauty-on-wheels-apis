export const TASK_LOOKUP_SK = 'LOOKUP';

export const ENTITY_TYPE_RUNTIME_TASK = 'RuntimeTaskInstance';
export const ENTITY_TYPE_TASK_LOOKUP = 'TaskLookup';
export const ENTITY_TYPE_TASK_HISTORY = 'TaskStateHistory';

export const TRANSACT_INDEX_META = 0;

export const MONITORING_SYSTEM_ACTOR = 'system:monitoring-runtime';
export const SERVICE_FLOW_SYSTEM_ACTOR = 'system:service-flow-runtime';
export const CARE_PLAN_SYSTEM_ACTOR = 'system:care-plan-runtime';
export const LINKED_SOURCE_SYSTEM_ACTOR = 'system:linked-source';

export function manualSystemActor(userId: string): string {
  return `user:${userId.trim()}`;
}

export const DUE_SORT_SENTINEL_MS = 9999999999999;

/** Care-plan scoped META list (LSI on `pk` + `sk1`). */
export const CARE_PLAN_LSI_INDEX = process.env.CARE_PLAN_LSI_INDEX?.trim() || 'pk-sk1';

/** Staff inbox (GSI on `gsi1pk` + `gsi1sk`). */
export const STAFF_TASKS_GSI_INDEX = process.env.STAFF_TASKS_GSI_INDEX?.trim() || 'GSI1';
