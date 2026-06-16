import { REMINDER_CHANNEL } from '../models/types/task-domain.types';
import { RUNTIME_TASK_STATE } from '../models/types/runtime-task-state.type';
import {
  isReminderRegistrationEligible,
  mergeReminderSettingsForUpdate,
  reminderSettingsEqual,
  resolveReminderCoordination,
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

  it('resolves disable path to cancel only', () => {
    expect(
      resolveReminderCoordination({
        previousEnabled: true,
        previousSettings: { channels: ['push'] },
        newEnabled: false,
        newSettings: { channels: ['push'] },
        currentState: RUNTIME_TASK_STATE.OPEN,
      }),
    ).toEqual({ shouldCancel: true, shouldRegister: false });
  });

  it('resolves enable on eligible task to register only', () => {
    expect(
      resolveReminderCoordination({
        previousEnabled: false,
        previousSettings: undefined,
        newEnabled: true,
        newSettings: { channels: ['push'] },
        currentState: RUNTIME_TASK_STATE.OPEN,
      }),
    ).toEqual({ shouldCancel: false, shouldRegister: true });
  });

  it('resolves re-register when enabled and settings change', () => {
    expect(
      resolveReminderCoordination({
        previousEnabled: true,
        previousSettings: { channels: ['push'] },
        newEnabled: true,
        newSettings: { channels: ['sms'] },
        currentState: RUNTIME_TASK_STATE.ACTIVE,
      }),
    ).toEqual({ shouldCancel: true, shouldRegister: true });
  });

  it('does not register on terminal task even when enabling', () => {
    expect(
      resolveReminderCoordination({
        previousEnabled: false,
        previousSettings: undefined,
        newEnabled: true,
        newSettings: { channels: ['push'] },
        currentState: RUNTIME_TASK_STATE.COMPLETED,
      }),
    ).toEqual({ shouldCancel: false, shouldRegister: false });
    expect(isReminderRegistrationEligible(RUNTIME_TASK_STATE.COMPLETED)).toBe(false);
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
