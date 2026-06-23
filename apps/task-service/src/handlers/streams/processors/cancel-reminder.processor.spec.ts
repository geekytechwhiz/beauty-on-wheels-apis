// eslint-disable-next-line no-var
var mockRecordReminderCancellation: jest.Mock;

jest.mock('@api-hub/task-core', () => {
  mockRecordReminderCancellation = jest.fn().mockResolvedValue({ written: true });
  const actual = jest.requireActual<typeof import('@api-hub/task-core')>('@api-hub/task-core');
  return {
    ...actual,
    TaskService: jest.fn().mockImplementation(() => ({
      recordReminderCancellation: mockRecordReminderCancellation,
    })),
  };
});

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

  it('cancels reminder schedule and persists LOOKUP history', async () => {
    await processCancelReminder(
      {
        entityType: 'RuntimeTaskInstance',
        runtimeTaskInstanceId: 'task-1',
        orgId: 'org-1',
        patientId: 'pat-1',
        reminderEnabled: false,
        currentState: 'open',
      },
      'corr-1',
    );

    expect(cancel).toHaveBeenCalledWith({
      runtimeTaskInstanceId: 'task-1',
      patientId: 'pat-1',
      orgId: 'org-1',
      reason: 'remindersDisabled',
    });
    expect(mockRecordReminderCancellation).toHaveBeenCalledWith({
      runtimeTaskInstanceId: 'task-1',
      reason: 'remindersDisabled',
      correlationId: 'corr-1',
    });
  });
});
