import {
  setReminderSchedulerGatewayForTests,
} from '../../../reminder/reminder-scheduler.gateway';
import type { ReminderSchedulerGateway } from '../../../reminder/reminder-scheduler.types';
import { processRegisterReminder } from './register-reminder.processor';

describe('processRegisterReminder', () => {
  const register = jest.fn().mockResolvedValue(undefined);
  const gateway: ReminderSchedulerGateway = { register, cancel: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    setReminderSchedulerGatewayForTests(gateway);
  });

  afterAll(() => {
    setReminderSchedulerGatewayForTests(undefined);
  });

  it('registers reminder schedule from META payload', async () => {
    await processRegisterReminder(
      {
        entityType: 'RuntimeTaskInstance',
        runtimeTaskInstanceId: 'task-1',
        orgId: 'org-1',
        patientId: 'pat-1',
        reminderEnabled: true,
        currentState: 'open',
        dueWindowEnd: 1_700_000_360_000,
        reminderSettings: { channels: ['push'] },
      },
      'corr-1',
    );

    expect(register).toHaveBeenCalledWith({
      runtimeTaskInstanceId: 'task-1',
      patientId: 'pat-1',
      orgId: 'org-1',
      scheduledAt: 1_700_000_360_000,
      channel: 'push',
      correlationId: 'corr-1',
    });
  });
});
