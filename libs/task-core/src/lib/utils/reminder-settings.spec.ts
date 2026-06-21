import { REMINDER_CHANNEL } from '../models/types/task-domain.types';
import { RUNTIME_TASK_STATE } from '../models/types/runtime-task-state.type';
import {
  isReminderRegistrationEligible,
  mergeReminderSettingsForUpdate,
  reminderSettingsEqual,
} from './reminder-settings';

describe('reminder-settings utils', () => {
  it('detects equal reminder settings', () => {
    expect(
      reminderSettingsEqual(
        { channels: ['push', 'inApp'], quietHoursRespected: true },
        { channels: ['inApp', 'push'], quietHoursRespected: true },
      ),
    ).toBe(true);
  });

  it('rejects enable on terminal task state', () => {
    expect(isReminderRegistrationEligible(RUNTIME_TASK_STATE.COMPLETED)).toBe(false);
    expect(isReminderRegistrationEligible(RUNTIME_TASK_STATE.OPEN)).toBe(true);
  });

  it('merges settings when request omits reminderSettings', () => {
    expect(mergeReminderSettingsForUpdate({ channels: ['push'] }, undefined)).toEqual({
      channels: ['push'],
    });
  });

  it('accepts canonical reminder channels', () => {
    expect(REMINDER_CHANNEL.PUSH).toBe('push');
    expect(REMINDER_CHANNEL.IN_APP).toBe('inApp');
  });
});
