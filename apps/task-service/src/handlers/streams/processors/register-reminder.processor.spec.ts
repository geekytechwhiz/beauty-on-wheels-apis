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

describe('processRegisterReminder', () => {
  const register = jest.fn().mockResolvedValue(undefined);
  const gateway: ReminderSchedulerGateway = { register, cancel: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    setReminderSchedulerGatewayForTests(gateway);
    setQuietHoursProviderForTests(nullQuietHoursProvider);
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
    dueWindowEnd: 1_700_000_360_000,
    reminderSettings: { channels: ['push'] },
  };

  it('registers reminder schedule from META payload (no quiet-hours adjustment)', async () => {
    await processRegisterReminder(basePayload, 'corr-1');

    expect(register).toHaveBeenCalledWith({
      runtimeTaskInstanceId: 'task-1',
      patientId: 'pat-1',
      orgId: 'org-1',
      scheduledAt: 1_700_000_360_000,
      channel: 'push',
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
  });

  it('skips registration without throwing when no due window', async () => {
    const payload = { ...basePayload, dueWindowEnd: undefined as unknown as number };
    await processRegisterReminder(payload, 'corr-1');
    expect(register).not.toHaveBeenCalled();
  });

  it('applies quiet-hours clamp when provider returns a window and target is inside it', async () => {
    // dueWindowEnd at 23:00 UTC — inside quiet 22:00–07:00 UTC
    const dueEnd = new Date('2026-06-22T23:00:00.000Z').getTime();
    const dueStart = new Date('2026-06-22T08:00:00.000Z').getTime();
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

    await processRegisterReminder(payload, 'corr-1');

    const quietStart = new Date('2026-06-22T22:00:00.000Z').getTime();
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: quietStart - 300_000 }),
    );
  });

  it('does not adjust when quiet-hours provider returns null', async () => {
    const dueEnd = new Date('2026-06-22T23:00:00.000Z').getTime();
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
