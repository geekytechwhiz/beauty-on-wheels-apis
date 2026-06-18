/** Canonical runtime task state values (camelCase wire + persistence). */
export const RUNTIME_TASK_STATE = {
  OPEN: 'open',
  /** @deprecated Legacy persistence — normalized to `open` on API wire. */
  SCHEDULED: 'scheduled',
  /** @deprecated Legacy persistence — normalized to `open` on API wire. */
  ACTIVE: 'active',
  COMPLETED: 'completed',
  MISSED: 'missed',
  DISMISSED: 'dismissed',
  CANCELLED: 'cancelled',
} as const;

export type RuntimeTaskState = (typeof RUNTIME_TASK_STATE)[keyof typeof RUNTIME_TASK_STATE];

export const TERMINAL_RUNTIME_TASK_STATES: RuntimeTaskState[] = [
  RUNTIME_TASK_STATE.COMPLETED,
  RUNTIME_TASK_STATE.MISSED,
  RUNTIME_TASK_STATE.DISMISSED,
  RUNTIME_TASK_STATE.CANCELLED,
];

/** Maps legacy `active`/`scheduled` rows to `open` for API responses. */
export function normalizeCurrentStateForWire(state: RuntimeTaskState): RuntimeTaskState {
  if (state === RUNTIME_TASK_STATE.ACTIVE || state === RUNTIME_TASK_STATE.SCHEDULED) {
    return RUNTIME_TASK_STATE.OPEN;
  }
  return state;
}
