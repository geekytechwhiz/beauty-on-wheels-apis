import { calendarDateKey, resolveDueWindowEndMs, nowEpochMs } from '../../utils/task-time';

/** Persisted + wire runtime task state values (camelCase). */
export const RUNTIME_TASK_STATE = {
  /** Persisted in-progress state. */
  SCHEDULED: 'scheduled',
  /** Wire-only — derived from schedule when persisted is `scheduled`. */
  ACTIVE: 'active',
  COMPLETED: 'completed',
  /** Wire-only — derived from schedule when persisted is `scheduled`. */
  MISSED: 'missed',
  DISMISSED: 'dismissed',
  CANCELLED: 'cancelled',
} as const;

export type RuntimeTaskState = (typeof RUNTIME_TASK_STATE)[keyof typeof RUNTIME_TASK_STATE];

/** @deprecated Legacy persistence value — normalized to `scheduled` on read. */
export const LEGACY_RUNTIME_TASK_STATE_OPEN = 'open' as const;

export const TERMINAL_RUNTIME_TASK_STATES: RuntimeTaskState[] = [
  RUNTIME_TASK_STATE.COMPLETED,
  RUNTIME_TASK_STATE.DISMISSED,
  RUNTIME_TASK_STATE.CANCELLED,
];

export type ResolveCurrentStateForWireInput = {
  persistedState: RuntimeTaskState | string;
  dueWindowStart?: number;
  dueWindowEnd?: number;
  timeZone: string;
  nowMs?: number;
};

/** Normalize legacy persisted values to the current persistence model. */
export function normalizePersistedState(state: RuntimeTaskState | string): RuntimeTaskState {
  if (
    state === LEGACY_RUNTIME_TASK_STATE_OPEN ||
    state === RUNTIME_TASK_STATE.ACTIVE ||
    state === RUNTIME_TASK_STATE.SCHEDULED
  ) {
    return RUNTIME_TASK_STATE.SCHEDULED;
  }
  return state as RuntimeTaskState;
}

export function isPersistedInProgress(state: RuntimeTaskState | string): boolean {
  return normalizePersistedState(state) === RUNTIME_TASK_STATE.SCHEDULED;
}

export function isTerminalPersistedState(state: RuntimeTaskState | string): boolean {
  const normalized = normalizePersistedState(state);
  return TERMINAL_RUNTIME_TASK_STATES.includes(normalized);
}

/** Derive API wire `currentState` from persisted META + due window calendar rules. */
export function resolveCurrentStateForWire(input: ResolveCurrentStateForWireInput): RuntimeTaskState {
  const persisted = normalizePersistedState(input.persistedState);
  if (TERMINAL_RUNTIME_TASK_STATES.includes(persisted)) {
    return persisted;
  }

  const nowMs = input.nowMs ?? nowEpochMs();
  const endMs = resolveDueWindowEndMs(input.dueWindowStart, input.dueWindowEnd);

  if (input.dueWindowStart == null && endMs == null) {
    return RUNTIME_TASK_STATE.ACTIVE;
  }

  const todayKey = calendarDateKey(nowMs, input.timeZone);
  const startDateKey =
    input.dueWindowStart != null
      ? calendarDateKey(input.dueWindowStart, input.timeZone)
      : todayKey;
  const dueDateKey = calendarDateKey(endMs ?? input.dueWindowStart!, input.timeZone);

  if (todayKey < startDateKey) {
    return RUNTIME_TASK_STATE.SCHEDULED;
  }
  if (todayKey >= startDateKey && todayKey <= dueDateKey) {
    return RUNTIME_TASK_STATE.ACTIVE;
  }
  return RUNTIME_TASK_STATE.MISSED;
}

/** @deprecated Use resolveCurrentStateForWire — kept for gradual migration of imports. */
export function normalizeCurrentStateForWire(
  state: RuntimeTaskState,
  dueWindowStart?: number,
  dueWindowEnd?: number,
  timeZone = 'UTC',
  nowMs = nowEpochMs(),
): RuntimeTaskState {
  return resolveCurrentStateForWire({
    persistedState: state,
    dueWindowStart,
    dueWindowEnd,
    timeZone,
    nowMs,
  });
}
