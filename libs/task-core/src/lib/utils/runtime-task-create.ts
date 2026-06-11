import { RUNTIME_TASK_STATE, type RuntimeTaskState } from '../models/types/runtime-task-state.type';

export function initialStateForRuntimeCreate(
  dueWindowStart: number | undefined,
  nowMs = Date.now(),
): RuntimeTaskState {
  if (dueWindowStart == null) {
    return RUNTIME_TASK_STATE.ACTIVE;
  }
  return dueWindowStart <= nowMs ? RUNTIME_TASK_STATE.ACTIVE : RUNTIME_TASK_STATE.SCHEDULED;
}
