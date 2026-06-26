import { RUNTIME_TASK_STATE, type RuntimeTaskState } from '../models/types/runtime-task-state.type';
import { nowEpochMs } from './task-time';

export function initialStateForRuntimeCreate(
  _dueWindowStart?: number,
  _nowMs = nowEpochMs(),
): RuntimeTaskState {
  return RUNTIME_TASK_STATE.OPEN;
}
