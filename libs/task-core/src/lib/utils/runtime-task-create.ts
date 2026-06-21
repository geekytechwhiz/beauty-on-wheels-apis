import { RUNTIME_TASK_STATE, type RuntimeTaskState } from '../models/types/runtime-task-state.type';

export function initialStateForRuntimeCreate(
  _dueWindowStart?: number,
  _nowMs = Date.now(),
): RuntimeTaskState {
  return RUNTIME_TASK_STATE.OPEN;
}
