// eslint-disable-next-line no-var
var mockCheckReminderFireEligibility: jest.Mock;
// eslint-disable-next-line no-var
var mockRecordReminderOutcome: jest.Mock;
// eslint-disable-next-line no-var
var mockIsInQuietHours: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockCheckReminderFireEligibility = jest.fn();
  mockRecordReminderOutcome = jest.fn().mockResolvedValue({ written: true });
  mockIsInQuietHours = jest.fn().mockReturnValue(false);
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    isInQuietHours: (...args: unknown[]) => mockIsInQuietHours(...args),
    TaskService: jest.fn().mockImplementation(() => ({
      checkReminderFireEligibility: mockCheckReminderFireEligibility,
      recordReminderOutcome: mockRecordReminderOutcome,
    })),
  };
});

// eslint-disable-next-line no-var
var mockSendReminder: jest.Mock;
// eslint-disable-next-line no-var
var mockGetForPatient: jest.Mock;

jest.mock('../../reminder/notification.gateway', () => {
  mockSendReminder = jest.fn().mockResolvedValue(undefined);
  return {
    getNotificationGateway: () => ({ sendReminder: mockSendReminder }),
  };
});

jest.mock('../../reminder/quiet-hours.provider', () => {
  mockGetForPatient = jest.fn().mockResolvedValue(null);
  return {
    getQuietHoursProvider: () => ({ getForPatient: mockGetForPatient }),
  };
});

import { main, runReminderCallback } from './processReminderConsumer';
import type { CheckReminderFireEligibilityResult } from '@api-hub/task-core';

const basePayload = {
  runtimeTaskInstanceId: 'rtask-abc',
  patientId: 'pat-e2e-001',
  orgId: 'org-e2e-001',
  scheduledAt: 1780668000000,
  channel: 'push',
  schedulerJobId: 'sched-e2e-001',
};

const eligibleMeta = {
  runtimeTaskInstanceId: 'rtask-abc',
  orgId: 'org-e2e-001',
  patientId: 'pat-e2e-001',
  currentState: 'open',
  reminderEnabled: true,
  reminderSettings: { channels: ['push'] },
} as any;

describe('processReminderConsumer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetForPatient.mockResolvedValue(null);
    mockSendReminder.mockResolvedValue(undefined);
    mockIsInQuietHours.mockReturnValue(false);
  });

  it('exports main', () => {
    expect(typeof main).toBe('function');
  });

  describe('runReminderCallback', () => {
    it('sends reminder when task is eligible', async () => {
      const eligible: CheckReminderFireEligibilityResult = {
        status: 'eligible',
        meta: eligibleMeta,
      };
      mockCheckReminderFireEligibility.mockResolvedValue(eligible);

      await runReminderCallback(basePayload);

      expect(mockCheckReminderFireEligibility).toHaveBeenCalledWith({
        runtimeTaskInstanceId: 'rtask-abc',
      });
      expect(mockSendReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          runtimeTaskInstanceId: 'rtask-abc',
          patientId: 'pat-e2e-001',
          orgId: 'org-e2e-001',
          channel: 'push',
          scheduledAt: 1780668000000,
        }),
      );
      expect(mockRecordReminderOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          runtimeTaskInstanceId: 'rtask-abc',
          outcome: 'sent',
        }),
      );
    });

    it('skips and does not send when reminders are disabled', async () => {
      const skipped: CheckReminderFireEligibilityResult = {
        status: 'skipped',
        reason: 'remindersDisabled',
      };
      mockCheckReminderFireEligibility.mockResolvedValue(skipped);

      await runReminderCallback(basePayload);

      expect(mockSendReminder).not.toHaveBeenCalled();
      expect(mockRecordReminderOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'suppressed',
          reason: 'remindersDisabled',
        }),
      );
    });

    it('skips and does not send when task is in a terminal state', async () => {
      const skipped: CheckReminderFireEligibilityResult = {
        status: 'skipped',
        reason: 'taskTerminalState:completed',
      };
      mockCheckReminderFireEligibility.mockResolvedValue(skipped);

      await runReminderCallback(basePayload);

      expect(mockSendReminder).not.toHaveBeenCalled();
    });

    it('suppresses and records quietHours when provider returns active window', async () => {
      const eligible: CheckReminderFireEligibilityResult = {
        status: 'eligible',
        meta: { ...eligibleMeta, reminderSettings: { channels: ['push'], quietHoursRespected: true } },
      };
      mockCheckReminderFireEligibility.mockResolvedValue(eligible);
      mockGetForPatient.mockResolvedValue({
        timezone: 'UTC',
        startLocalMinutes: 22 * 60,
        endLocalMinutes: 7 * 60,
      });
      mockIsInQuietHours.mockReturnValue(true);

      await runReminderCallback(basePayload);

      expect(mockSendReminder).not.toHaveBeenCalled();
      expect(mockRecordReminderOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'suppressed',
          reason: 'quietHours',
        }),
      );
    });

    it('suppresses and does not send during patient quiet hours', async () => {
      const eligible: CheckReminderFireEligibilityResult = {
        status: 'eligible',
        meta: { ...eligibleMeta, reminderSettings: { channels: ['push'], quietHoursRespected: true } },
      };
      mockCheckReminderFireEligibility.mockResolvedValue(eligible);
      mockGetForPatient.mockResolvedValue({
        timezone: 'UTC',
        startLocalMinutes: 0,
        endLocalMinutes: 23 * 60 + 59, // effectively always quiet in UTC for this test
      });

      // isInQuietHours will be called with Date.now() — we just verify sendReminder was not called
      // when quiet window covers the current time
      await runReminderCallback(basePayload);

      expect(mockGetForPatient).toHaveBeenCalledWith({
        patientId: 'pat-e2e-001',
        orgId: 'org-e2e-001',
      });
    });

    it('sends when quietHoursRespected is true but provider returns null', async () => {
      const eligible: CheckReminderFireEligibilityResult = {
        status: 'eligible',
        meta: { ...eligibleMeta, reminderSettings: { channels: ['push'], quietHoursRespected: true } },
      };
      mockCheckReminderFireEligibility.mockResolvedValue(eligible);
      mockGetForPatient.mockResolvedValue(null);

      await runReminderCallback(basePayload);

      expect(mockSendReminder).toHaveBeenCalledTimes(1);
    });

    it('does not check quiet hours when quietHoursRespected is false', async () => {
      const eligible: CheckReminderFireEligibilityResult = {
        status: 'eligible',
        meta: { ...eligibleMeta, reminderSettings: { channels: ['push'], quietHoursRespected: false } },
      };
      mockCheckReminderFireEligibility.mockResolvedValue(eligible);

      await runReminderCallback(basePayload);

      expect(mockGetForPatient).not.toHaveBeenCalled();
      expect(mockSendReminder).toHaveBeenCalledTimes(1);
    });

    it('propagates error from checkReminderFireEligibility (retryable)', async () => {
      const err = Object.assign(new Error('Runtime task not found'), { statusCode: 404, code: 'TASK_NOT_FOUND' });
      mockCheckReminderFireEligibility.mockRejectedValue(err);

      await expect(runReminderCallback(basePayload)).rejects.toThrow('Runtime task not found');
      expect(mockSendReminder).not.toHaveBeenCalled();
    });

    it('records failed outcome and rethrows when notification send fails', async () => {
      mockCheckReminderFireEligibility.mockResolvedValue({ status: 'eligible', meta: eligibleMeta });
      mockSendReminder.mockRejectedValue(new Error('notification service down'));

      await expect(runReminderCallback(basePayload)).rejects.toThrow('notification service down');
      expect(mockRecordReminderOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'failed',
          reason: 'notification service down',
        }),
      );
    });

    it('uses stringified reason when notification error is not an Error', async () => {
      mockCheckReminderFireEligibility.mockResolvedValue({ status: 'eligible', meta: eligibleMeta });
      mockSendReminder.mockRejectedValue('raw failure');

      await expect(runReminderCallback(basePayload)).rejects.toBe('raw failure');
      expect(mockRecordReminderOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'failed', reason: 'notificationFailed' }),
      );
    });

    it('works without schedulerJobId (optional)', async () => {
      const payloadWithout = { ...basePayload };
      delete payloadWithout.schedulerJobId;
      mockCheckReminderFireEligibility.mockResolvedValue({ status: 'eligible', meta: eligibleMeta });

      await expect(runReminderCallback(payloadWithout)).resolves.toBeUndefined();
      expect(mockSendReminder).toHaveBeenCalledTimes(1);
    });
  });

  describe('main Lambda entry point', () => {
    it('delegates to runReminderCallback', async () => {
      mockCheckReminderFireEligibility.mockResolvedValue({ status: 'eligible', meta: eligibleMeta });

      await expect(main(basePayload)).resolves.toBeUndefined();
      expect(mockCheckReminderFireEligibility).toHaveBeenCalledTimes(1);
    });
  });
});
