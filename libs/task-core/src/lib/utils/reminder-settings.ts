import type { ReminderSettings } from '../models/types/task-domain.types';
import {
  TERMINAL_RUNTIME_TASK_STATES,
  type RuntimeTaskState,
} from '../models/types/runtime-task-state.type';

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

export function mergeReminderSettingsForUpdate(
  current: ReminderSettings | undefined,
  requested: ReminderSettings | undefined,
): ReminderSettings | undefined {
  if (requested !== undefined) {
    return requested;
  }
  return current;
}
