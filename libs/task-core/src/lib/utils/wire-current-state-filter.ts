import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import {
  resolveCurrentStateForWire,
  RUNTIME_TASK_STATE,
  type RuntimeTaskState,
} from '../models/types/runtime-task-state.type';
import { DEFAULT_ACTION_CENTER_TIMEZONE, nowEpochMs } from './task-time';

const PERSISTED_QUERY_STATES: RuntimeTaskState[] = [
  RUNTIME_TASK_STATE.COMPLETED,
  RUNTIME_TASK_STATE.DISMISSED,
  RUNTIME_TASK_STATE.CANCELLED,
];

const WIRE_DERIVED_QUERY_STATES: RuntimeTaskState[] = [
  RUNTIME_TASK_STATE.SCHEDULED,
  RUNTIME_TASK_STATE.ACTIVE,
  RUNTIME_TASK_STATE.MISSED,
];

export function isWireDerivedCurrentStateFilter(
  currentState: RuntimeTaskState | undefined,
): currentState is RuntimeTaskState {
  return (
    currentState != null && WIRE_DERIVED_QUERY_STATES.includes(currentState)
  );
}

export function repositoryCurrentStateFilter(
  currentState: RuntimeTaskState | undefined,
): RuntimeTaskState | undefined {
  if (currentState == null || isWireDerivedCurrentStateFilter(currentState)) {
    return undefined;
  }
  if (PERSISTED_QUERY_STATES.includes(currentState)) {
    return currentState;
  }
  return undefined;
}

export function matchesWireCurrentStateFilter(
  record: TaskMetaDdbRecord,
  wireFilter: RuntimeTaskState,
  timeZone = DEFAULT_ACTION_CENTER_TIMEZONE,
  nowMs = nowEpochMs(),
): boolean {
  const wireState = resolveCurrentStateForWire({
    persistedState: record.currentState,
    dueWindowStart: record.dueWindowStart,
    dueWindowEnd: record.dueWindowEnd,
    timeZone,
    nowMs,
  });
  return wireState === wireFilter;
}
