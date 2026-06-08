import type { CreateMonitoringActionRequest } from '../models/api/create-monitoring-action.request';
import {
  TASK_DISPLAY_GROUP,
  type TaskBehaviorCode,
  type TaskDisplayGroup,
} from '../models/types/task-domain.types';
import { RUNTIME_TASK_STATE, type RuntimeTaskState } from '../models/types/runtime-task-state.type';

const DISPLAY_TITLES: Partial<Record<TaskBehaviorCode, string>> = {
  METRIC_CHECKIN: 'Record your health metrics',
  SYMPTOM_CHECKIN: 'Complete your symptom check-in',
  DEVICE_SETUP: 'Set up your device',
};

export function taskDisplayGroupForBehavior(code: TaskBehaviorCode): TaskDisplayGroup {
  if (code === 'METRIC_CHECKIN' || code === 'SYMPTOM_CHECKIN') {
    return TASK_DISPLAY_GROUP.CHECK_IN;
  }
  if (code === 'DEVICE_SETUP') {
    return TASK_DISPLAY_GROUP.ACTION;
  }
  return TASK_DISPLAY_GROUP.CHECK_IN;
}

export function displayTitleForMonitoringTask(code: TaskBehaviorCode): string {
  return DISPLAY_TITLES[code] ?? `Complete your ${code.replace(/_/g, ' ').toLowerCase()}`;
}

export function initialStateForMonitoringCreate(
  dueWindowStart: number,
  nowMs = Date.now(),
): RuntimeTaskState {
  return dueWindowStart <= nowMs ? RUNTIME_TASK_STATE.ACTIVE : RUNTIME_TASK_STATE.SCHEDULED;
}

export function reminderEnabledFromContext(
  input: Pick<CreateMonitoringActionRequest, 'reminderContext'>,
): boolean {
  return input.reminderContext != null && typeof input.reminderContext === 'object';
}
