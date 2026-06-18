import type { ReminderSettings } from '../models/types/task-domain.types';
import {
  TERMINAL_RUNTIME_TASK_STATES,
  type RuntimeTaskState,
} from '../models/types/runtime-task-state.type';

export type ReminderCoordinationInput = {
  previousEnabled: boolean | undefined;
  previousSettings: ReminderSettings | undefined;
  newEnabled: boolean;
  newSettings: ReminderSettings | undefined;
  currentState: RuntimeTaskState;
};

export type ReminderCoordinationResult = {
  shouldCancel: boolean;
  shouldRegister: boolean;
};

function sortedChannels(channels: string[] | undefined): string[] {
  return [...(channels ?? [])].sort();
}

export function reminderSettingsEqual(
  a: ReminderSettings | undefined,
  b: ReminderSettings | undefined,
): boolean {
  const aChannels = sortedChannels(a?.channels);
  const bChannels = sortedChannels(b?.channels);
  if (aChannels.length !== bChannels.length) {
    return false;
  }
  for (let i = 0; i < aChannels.length; i++) {
    if (aChannels[i] !== bChannels[i]) {
      return false;
    }
  }
  const aQuiet = a?.quietHoursRespected ?? false;
  const bQuiet = b?.quietHoursRespected ?? false;
  return aQuiet === bQuiet;
}

export function isReminderRegistrationEligible(currentState: RuntimeTaskState): boolean {
  return !TERMINAL_RUNTIME_TASK_STATES.includes(currentState);
}

export function resolveReminderCoordination(
  input: ReminderCoordinationInput,
): ReminderCoordinationResult {
  const previousEnabled = input.previousEnabled === true;
  const newEnabled = input.newEnabled;
  const settingsChanged = !reminderSettingsEqual(input.previousSettings, input.newSettings);
  const enabledChanged = previousEnabled !== newEnabled;
  const eligible = isReminderRegistrationEligible(input.currentState);

  if (!enabledChanged && !settingsChanged) {
    return { shouldCancel: false, shouldRegister: false };
  }

  if (!newEnabled) {
    return { shouldCancel: previousEnabled, shouldRegister: false };
  }

  if (!eligible) {
    return { shouldCancel: false, shouldRegister: false };
  }

  if (!previousEnabled) {
    return { shouldCancel: false, shouldRegister: true };
  }

  if (settingsChanged) {
    return { shouldCancel: true, shouldRegister: true };
  }

  return { shouldCancel: false, shouldRegister: false };
}

export function normalizeReminderEnabled(value: boolean | undefined): boolean {
  return value === true;
}

export function mergeReminderSettingsForUpdate(
  current: ReminderSettings | undefined,
  requested: ReminderSettings | undefined,
): ReminderSettings | undefined {
  if (requested !== undefined) {
    return requested;
  }
  return current;
}
