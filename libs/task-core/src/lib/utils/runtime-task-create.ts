import { RUNTIME_TASK_STATE, type RuntimeTaskState } from '../models/types/runtime-task-state.type';

export function initialStateForRuntimeCreate(): RuntimeTaskState {
  return RUNTIME_TASK_STATE.SCHEDULED;
}
