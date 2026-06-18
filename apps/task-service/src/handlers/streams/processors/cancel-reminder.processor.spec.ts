import {
  setReminderSchedulerGatewayForTests,
} from '../../../reminder/reminder-scheduler.gateway';
import type { ReminderSchedulerGateway } from '../../../reminder/reminder-scheduler.types';
import { processCancelReminder } from './cancel-reminder.processor';

describe('processCancelReminder', () => {
  const cancel = jest.fn().mockResolvedValue(undefined);
  const gateway: ReminderSchedulerGateway = { register: jest.fn(), cancel };

  beforeEach(() => {
    jest.clearAllMocks();
    setReminderSchedulerGatewayForTests(gateway);
  });

  afterAll(() => {
    setReminderSchedulerGatewayForTests(undefined);
  });

  it('cancels reminder schedule from META payload', async () => {
    await processCancelReminder({
      entityType: 'RuntimeTaskInstance',
      runtimeTaskInstanceId: 'task-1',
      orgId: 'org-1',
      patientId: 'pat-1',
      reminderEnabled: false,
      currentState: 'open',
    });

    expect(cancel).toHaveBeenCalledWith({
      runtimeTaskInstanceId: 'task-1',
      patientId: 'pat-1',
      orgId: 'org-1',
      reason: 'remindersDisabled',
    });
  });
});
