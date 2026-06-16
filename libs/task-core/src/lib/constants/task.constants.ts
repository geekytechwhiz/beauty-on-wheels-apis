export const TASK_LOOKUP_SK = 'LOOKUP';

export const ENTITY_TYPE_RUNTIME_TASK = 'RuntimeTaskInstance';
export const ENTITY_TYPE_TASK_LOOKUP = 'TaskLookup';
export const ENTITY_TYPE_TASK_HISTORY = 'TaskStateHistory';

export const TRANSACT_INDEX_META = 0;

export const MONITORING_SYSTEM_ACTOR = 'system:monitoring-runtime';
export const SERVICE_FLOW_SYSTEM_ACTOR = 'system:service-flow-runtime';
export const CARE_PLAN_SYSTEM_ACTOR = 'system:care-plan-runtime';

export function manualSystemActor(userId: string): string {
  return `user:${userId.trim()}`;
}

export const DUE_SORT_SENTINEL_MS = 9999999999999;

/** LSI1 on patient META partition — care-plan scoped task lists. */
export const CARE_PLAN_INDEX = 'CarePlanIndex';
