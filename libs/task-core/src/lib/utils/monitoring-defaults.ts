import type { CreateMonitoringActionRequest } from '../models/api/create-monitoring-action.request';
import {
  isPatientAssignedToType,
  TASK_DISPLAY_GROUP,
  type AssignedToType,
  type TaskDisplayGroup,
} from '../models/types/task-domain.types';
import { RUNTIME_TASK_STATE, type RuntimeTaskState } from '../models/types/runtime-task-state.type';

/** Behavior codes referenced by monitoring create defaults — not a full catalog. */
const MONITORING_BEHAVIOR_FOR_DEFAULTS = {
  METRIC_CHECKIN: 'METRIC_CHECKIN',
  SYMPTOM_CHECKIN: 'SYMPTOM_CHECKIN',
  DEVICE_SETUP: 'DEVICE_SETUP',
} as const;

const DISPLAY_TITLES: Record<string, string> = {
  [MONITORING_BEHAVIOR_FOR_DEFAULTS.METRIC_CHECKIN]: 'Record your health metrics',
  [MONITORING_BEHAVIOR_FOR_DEFAULTS.SYMPTOM_CHECKIN]: 'Complete your symptom check-in',
  [MONITORING_BEHAVIOR_FOR_DEFAULTS.DEVICE_SETUP]: 'Set up your device',
};

export function taskDisplayGroupForBehavior(code: string): TaskDisplayGroup {
  if (
    code === MONITORING_BEHAVIOR_FOR_DEFAULTS.METRIC_CHECKIN ||
    code === MONITORING_BEHAVIOR_FOR_DEFAULTS.SYMPTOM_CHECKIN
  ) {
    return TASK_DISPLAY_GROUP.CHECK_IN;
  }
  if (code === MONITORING_BEHAVIOR_FOR_DEFAULTS.DEVICE_SETUP) {
    return TASK_DISPLAY_GROUP.ACTION;
  }
  return TASK_DISPLAY_GROUP.CHECK_IN;
}

export function taskDisplayGroupForMonitoring(
  code: string,
  assignedToType: AssignedToType,
): TaskDisplayGroup {
  if (!isPatientAssignedToType(assignedToType)) {
    return TASK_DISPLAY_GROUP.STAFF_TASK;
  }
  return taskDisplayGroupForBehavior(code);
}

export function displayToPatientForMonitoring(assignedToType: AssignedToType): boolean {
  return isPatientAssignedToType(assignedToType);
}

export function displayTitleForMonitoringTask(code: string): string {
  return DISPLAY_TITLES[code] ?? `Complete your ${code.replace(/_/g, ' ').toLowerCase()}`;
}

export function initialStateForMonitoringCreate(): RuntimeTaskState {
  return RUNTIME_TASK_STATE.SCHEDULED;
}

export function reminderEnabledFromContext(
  input: Pick<CreateMonitoringActionRequest, 'reminderContext'>,
): boolean {
  return input.reminderContext != null && typeof input.reminderContext === 'object';
}
