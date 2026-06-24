// eslint-disable-next-line no-var
var mockRecordReminderRegistration: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockRecordReminderRegistration = jest.fn().mockResolvedValue({ written: true });
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      recordReminderRegistration: mockRecordReminderRegistration,
    })),
  };
});

import {
  setReminderSchedulerGatewayForTests,
} from '../../../reminder/reminder-scheduler.gateway';
import type { ReminderSchedulerGateway } from '../../../reminder/reminder-scheduler.types';
import {
  setQuietHoursProviderForTests,
  type QuietHoursProvider,
} from '../../../reminder/quiet-hours.provider';
import { processRegisterReminder } from './register-reminder.processor';

const nullQuietHoursProvider: QuietHoursProvider = {
  getForPatient: jest.fn().mockResolvedValue(null),
};

const FUTURE_DUE_WINDOW_END = new Date('2028-06-22T23:00:00.000Z').getTime();
const FUTURE_DUE_WINDOW_START = new Date('2028-06-22T08:00:00.000Z').getTime();

describe('processRegisterReminder', () => {
  const register = jest.fn();
  const gateway: ReminderSchedulerGateway = { register, cancel: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    setReminderSchedulerGatewayForTests(gateway);
    setQuietHoursProviderForTests(nullQuietHoursProvider);
    register.mockResolvedValue({
      outcome: 'created',
      schedulerJobId: 'task-reminder-task-1',
      scheduledAt: FUTURE_DUE_WINDOW_END,
    });
  });

  afterAll(() => {
    setReminderSchedulerGatewayForTests(undefined);
    setQuietHoursProviderForTests(undefined);
  });

  const basePayload = {
    entityType: 'RuntimeTaskInstance' as const,
    runtimeTaskInstanceId: 'task-1',
    orgId: 'org-1',
    patientId: 'pat-1',
    reminderEnabled: true,
    currentState: 'open',
    dueWindowEnd: FUTURE_DUE_WINDOW_END,
    reminderSettings: { channels: ['push'] },
  };

  it('registers reminder schedule and persists LOOKUP history', async () => {
    await processRegisterReminder(basePayload, 'corr-1');

    expect(register).toHaveBeenCalledWith({
      runtimeTaskInstanceId: 'task-1',
      patientId: 'pat-1',
      orgId: 'org-1',
      scheduledAt: FUTURE_DUE_WINDOW_END,
      channel: 'push',
      correlationId: 'corr-1',
    });
    expect(mockRecordReminderRegistration).toHaveBeenCalledWith({
      runtimeTaskInstanceId: 'task-1',
      scheduledAt: FUTURE_DUE_WINDOW_END,
      channel: 'push',
      schedulerJobId: 'task-reminder-task-1',
      correlationId: 'corr-1',
    });
  });

  it('fetches quiet-hours window for the patient', async () => {
    await processRegisterReminder(basePayload, 'corr-1');
    expect(nullQuietHoursProvider.getForPatient).toHaveBeenCalledWith({
      patientId: 'pat-1',
      orgId: 'org-1',
    });
  });

  it('skips registration without throwing when mapper returns null (no channel)', async () => {
    const payload = { ...basePayload, reminderSettings: { channels: [] as string[] } };
    await processRegisterReminder(payload, 'corr-1');
    expect(register).not.toHaveBeenCalled();
    expect(mockRecordReminderRegistration).not.toHaveBeenCalled();
  });

  it('skips registration without throwing when no due window', async () => {
    const payload = { ...basePayload, dueWindowEnd: undefined as unknown as number };
    await processRegisterReminder(payload, 'corr-1');
    expect(register).not.toHaveBeenCalled();
    expect(mockRecordReminderRegistration).not.toHaveBeenCalled();
  });

  it('does not persist when scheduler skips past fire time', async () => {
    register.mockResolvedValueOnce({ outcome: 'skipped', reason: 'fireTimeTooSoon' });
    await processRegisterReminder(basePayload, 'corr-1');
    expect(mockRecordReminderRegistration).not.toHaveBeenCalled();
  });

  it('applies quiet-hours clamp when provider returns a window and target is inside it', async () => {
    const dueEnd = new Date('2028-06-22T23:00:00.000Z').getTime();
    const dueStart = new Date('2028-06-22T08:00:00.000Z').getTime();
    const payload = {
      ...basePayload,
      dueWindowStart: dueStart,
      dueWindowEnd: dueEnd,
      reminderSettings: {
        channels: ['push'],
        quietHoursRespected: true,
        quietHoursBufferMs: 300_000,
      },
    };

    const quietProvider: QuietHoursProvider = {
      getForPatient: jest.fn().mockResolvedValue({
        timezone: 'UTC',
        startLocalMinutes: 22 * 60,
        endLocalMinutes: 7 * 60,
      }),
    };
    setQuietHoursProviderForTests(quietProvider);

    const quietStart = new Date('2028-06-22T22:00:00.000Z').getTime();
    const expectedScheduledAt = quietStart - 300_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(dueStart);
    register.mockResolvedValueOnce({
      outcome: 'created',
      schedulerJobId: 'task-reminder-task-1',
      scheduledAt: expectedScheduledAt,
    });

    await processRegisterReminder(payload, 'corr-1');

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: expectedScheduledAt }),
    );
    expect(mockRecordReminderRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: expectedScheduledAt }),
    );
    nowSpy.mockRestore();
  });

  it('does not adjust when quiet-hours provider returns null', async () => {
    const dueEnd = new Date('2028-06-22T23:00:00.000Z').getTime();
    const payload = {
      ...basePayload,
      dueWindowEnd: dueEnd,
      reminderSettings: { channels: ['push'], quietHoursRespected: true },
    };
    setQuietHoursProviderForTests({ getForPatient: jest.fn().mockResolvedValue(null) });

    await processRegisterReminder(payload, 'corr-1');

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: dueEnd }),
    );
  });
});
