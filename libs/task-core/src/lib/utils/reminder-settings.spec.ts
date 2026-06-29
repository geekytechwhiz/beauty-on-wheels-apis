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

  it('detects difference in scheduleAnchor', () => {
    expect(
      reminderSettingsEqual(
        { channels: ['push'], scheduleAnchor: 'dueWindowStart' },
        { channels: ['push'], scheduleAnchor: 'dueWindowEnd' },
      ),
    ).toBe(false);
  });

  it('treats missing scheduleAnchor as dueWindowEnd default', () => {
    expect(
      reminderSettingsEqual(
        { channels: ['push'] },
        { channels: ['push'], scheduleAnchor: 'dueWindowEnd' },
      ),
    ).toBe(true);
  });

  it('detects difference in offsetMs', () => {
    expect(
      reminderSettingsEqual(
        { channels: ['push'], offsetMs: 0 },
        { channels: ['push'], offsetMs: -3600000 },
      ),
    ).toBe(false);
  });

  it('treats missing offsetMs as 0 default', () => {
    expect(
      reminderSettingsEqual(
        { channels: ['push'] },
        { channels: ['push'], offsetMs: 0 },
      ),
    ).toBe(true);
  });

  it('detects difference in quietHoursBufferMs', () => {
    expect(
      reminderSettingsEqual(
        { channels: ['push'], quietHoursBufferMs: 300000 },
        { channels: ['push'], quietHoursBufferMs: 600000 },
      ),
    ).toBe(false);
  });

  it('treats missing quietHoursBufferMs as 300000 default', () => {
    expect(
      reminderSettingsEqual(
        { channels: ['push'] },
        { channels: ['push'], quietHoursBufferMs: 300000 },
      ),
    ).toBe(true);
  });

  it('rejects enable on terminal task state', () => {
    expect(isReminderRegistrationEligible(RUNTIME_TASK_STATE.COMPLETED)).toBe(false);
    expect(isReminderRegistrationEligible(RUNTIME_TASK_STATE.SCHEDULED)).toBe(true);
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
