import {
  ActionAfterCompletion,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  FlexibleTimeWindowMode,
  ResourceNotFoundException,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';

import { nowEpochMs } from '@api-hub/task-core';

import { EventBridgeSchedulerGateway } from './reminder-scheduler.gateway';
import type { ReminderSchedulerGatewayConfig } from './reminder-scheduler.gateway';

const config: ReminderSchedulerGatewayConfig = {
  scheduleGroupName: 'task-service-dev-reminders',
  targetLambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:task-service-dev-processReminder',
  targetRoleArn: 'arn:aws:iam::123456789012:role/reminder-scheduler-invoke',
  region: 'us-east-1',
};

function futureMs(minutesAhead = 10): number {
  return nowEpochMs() + minutesAhead * 60_000;
}

describe('EventBridgeSchedulerGateway', () => {
  const send = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function gateway(): EventBridgeSchedulerGateway {
    return new EventBridgeSchedulerGateway({ send } as never, config);
  }

  it('creates schedule when update returns ResourceNotFoundException', async () => {
    send
      .mockRejectedValueOnce(new ResourceNotFoundException({ message: 'not found', $metadata: {} }))
      .mockResolvedValueOnce({});

    const result = await gateway().register({
      runtimeTaskInstanceId: 'task-1',
      patientId: 'pat-1',
      orgId: 'org-1',
      scheduledAt: futureMs(),
      channel: 'push',
      correlationId: 'corr-1',
    });

    expect(result).toEqual({
      outcome: 'created',
      schedulerJobId: 'task-reminder-task-1',
      scheduledAt: expect.any(Number),
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBeInstanceOf(UpdateScheduleCommand);
    expect(send.mock.calls[1][0]).toBeInstanceOf(CreateScheduleCommand);

    const createInput = (send.mock.calls[1][0] as CreateScheduleCommand).input;
    expect(createInput.Name).toBe('task-reminder-task-1');
    expect(createInput.GroupName).toBe('task-service-dev-reminders');
    expect(createInput.ActionAfterCompletion).toBe(ActionAfterCompletion.DELETE);
    expect(createInput.FlexibleTimeWindow).toEqual({ Mode: FlexibleTimeWindowMode.OFF });
    expect(createInput.Target?.Arn).toBe(config.targetLambdaArn);
    expect(createInput.Target?.RoleArn).toBe(config.targetRoleArn);
    expect(JSON.parse(createInput.Target?.Input ?? '{}')).toMatchObject({
      runtimeTaskInstanceId: 'task-1',
      patientId: 'pat-1',
      orgId: 'org-1',
      channel: 'push',
      schedulerJobId: 'task-reminder-task-1',
    });
  });

  it('updates schedule when it already exists', async () => {
    send.mockResolvedValueOnce({});

    const result = await gateway().register({
      runtimeTaskInstanceId: 'task-1',
      patientId: 'pat-1',
      orgId: 'org-1',
      scheduledAt: futureMs(),
      channel: 'push',
    });

    expect(result).toEqual({
      outcome: 'updated',
      schedulerJobId: 'task-reminder-task-1',
      scheduledAt: expect.any(Number),
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(UpdateScheduleCommand);
  });

  it('skips register when fire time is too soon', async () => {
    const result = await gateway().register({
      runtimeTaskInstanceId: 'task-1',
      patientId: 'pat-1',
      orgId: 'org-1',
      scheduledAt: nowEpochMs() + 1_000,
      channel: 'push',
    });

    expect(result).toEqual({ outcome: 'skipped', reason: 'fireTimeTooSoon' });

    expect(send).not.toHaveBeenCalled();
  });

  it('deletes schedule on cancel', async () => {
    send.mockResolvedValueOnce({});

    await gateway().cancel({
      runtimeTaskInstanceId: 'task-1',
      patientId: 'pat-1',
      orgId: 'org-1',
      reason: 'remindersDisabled',
    });

    expect(send).toHaveBeenCalledTimes(1);
    const deleteInput = (send.mock.calls[0][0] as DeleteScheduleCommand).input;
    expect(deleteInput.Name).toBe('task-reminder-task-1');
    expect(deleteInput.GroupName).toBe('task-service-dev-reminders');
  });

  it('treats missing schedule as successful cancel', async () => {
    send.mockRejectedValueOnce(new ResourceNotFoundException({ message: 'not found', $metadata: {} }));

    await expect(
      gateway().cancel({
        runtimeTaskInstanceId: 'task-1',
        reason: 'taskTerminalState:completed',
      }),
    ).resolves.toBeUndefined();
  });

  it('rethrows non-ResourceNotFound errors on cancel', async () => {
    send.mockRejectedValueOnce(new Error('scheduler unavailable'));

    await expect(
      gateway().cancel({
        runtimeTaskInstanceId: 'task-1',
        reason: 'remindersDisabled',
      }),
    ).rejects.toThrow('scheduler unavailable');
  });

  it('rethrows non-ResourceNotFound errors on register', async () => {
    send.mockRejectedValueOnce(new Error('access denied'));

    await expect(
      gateway().register({
        runtimeTaskInstanceId: 'task-1',
        patientId: 'pat-1',
        orgId: 'org-1',
        scheduledAt: futureMs(),
        channel: 'push',
      }),
    ).rejects.toThrow('access denied');
  });
});

describe('getReminderSchedulerGateway', () => {
  const originalEnv = {
    REMINDER_SCHEDULER_GROUP_NAME: process.env.REMINDER_SCHEDULER_GROUP_NAME,
    PROCESS_REMINDER_LAMBDA_ARN: process.env.PROCESS_REMINDER_LAMBDA_ARN,
    REMINDER_SCHEDULER_TARGET_ROLE_ARN: process.env.REMINDER_SCHEDULER_TARGET_ROLE_ARN,
    AWS_REGION: process.env.AWS_REGION,
  };

  afterEach(() => {
    const { setReminderSchedulerGatewayForTests } = require('./reminder-scheduler.gateway');
    setReminderSchedulerGatewayForTests(undefined);
    process.env.REMINDER_SCHEDULER_GROUP_NAME = originalEnv.REMINDER_SCHEDULER_GROUP_NAME;
    process.env.PROCESS_REMINDER_LAMBDA_ARN = originalEnv.PROCESS_REMINDER_LAMBDA_ARN;
    process.env.REMINDER_SCHEDULER_TARGET_ROLE_ARN = originalEnv.REMINDER_SCHEDULER_TARGET_ROLE_ARN;
    process.env.AWS_REGION = originalEnv.AWS_REGION;
    jest.resetModules();
  });

  it('throws when required env vars are missing', () => {
    delete process.env.REMINDER_SCHEDULER_GROUP_NAME;
    const { setReminderSchedulerGatewayForTests, getReminderSchedulerGateway: getGw } = require('./reminder-scheduler.gateway');
    setReminderSchedulerGatewayForTests(undefined);
    expect(() => getGw()).toThrow(/REMINDER_SCHEDULER_GROUP_NAME/);
  });

  it('creates gateway from env when configured', () => {
    process.env.REMINDER_SCHEDULER_GROUP_NAME = 'grp';
    process.env.PROCESS_REMINDER_LAMBDA_ARN = 'arn:lambda:fn';
    process.env.REMINDER_SCHEDULER_TARGET_ROLE_ARN = 'arn:iam:role';
    process.env.AWS_REGION = 'us-east-1';
    const { setReminderSchedulerGatewayForTests, getReminderSchedulerGateway: getGw } = require('./reminder-scheduler.gateway');
    setReminderSchedulerGatewayForTests(undefined);
    const gw1 = getGw();
    const gw2 = getGw();
    expect(gw1).toBe(gw2);
  });

  it('uses REGION env when AWS_REGION unset', () => {
    process.env.REMINDER_SCHEDULER_GROUP_NAME = 'grp';
    process.env.PROCESS_REMINDER_LAMBDA_ARN = 'arn:lambda:fn';
    process.env.REMINDER_SCHEDULER_TARGET_ROLE_ARN = 'arn:iam:role';
    delete process.env.AWS_REGION;
    process.env.REGION = 'eu-west-1';
    const { setReminderSchedulerGatewayForTests, getReminderSchedulerGateway: getGw } = require('./reminder-scheduler.gateway');
    setReminderSchedulerGatewayForTests(undefined);
    expect(() => getGw()).not.toThrow();
  });
});
