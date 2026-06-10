/** Canonical runtime task state values (camelCase wire + persistence). */
export const RUNTIME_TASK_STATE = {
  SCHEDULED: 'scheduled',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  MISSED: 'missed',
  DISMISSED: 'dismissed',
  CANCELLED: 'cancelled',
} as const;

export type RuntimeTaskState = (typeof RUNTIME_TASK_STATE)[keyof typeof RUNTIME_TASK_STATE];
