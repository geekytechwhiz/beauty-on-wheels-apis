import {
  ActionAfterCompletion,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  FlexibleTimeWindowMode,
  ResourceNotFoundException,
  SchedulerClient,
  UpdateScheduleCommand,
  type SchedulerClientConfig,
} from '@aws-sdk/client-scheduler';
import { createLogger } from '@api-hub/observability';

import type {
  CancelReminderJobRequest,
  RegisterReminderJobRequest,
  ReminderSchedulerGateway,
} from './reminder-scheduler.types';
import {
  buildCancelLogContext,
  buildProcessReminderTargetInput,
  buildReminderScheduleName,
  isSchedulerEligibleFireTime,
  toSchedulerAtExpression,
} from './reminder-scheduler.schedule';

const logger = createLogger({ service: 'task-service', redactPII: true });

export interface ReminderSchedulerGatewayConfig {
  scheduleGroupName: string;
  targetLambdaArn: string;
  targetRoleArn: string;
  region?: string;
}

function readGatewayConfig(): ReminderSchedulerGatewayConfig {
  const scheduleGroupName = process.env.REMINDER_SCHEDULER_GROUP_NAME ?? 'default';
  const targetLambdaArn = process.env.PROCESS_REMINDER_LAMBDA_ARN;
  const targetRoleArn = process.env.REMINDER_SCHEDULER_TARGET_ROLE_ARN;

  if (!targetLambdaArn || !targetRoleArn) {
    throw new Error(
      'Reminder scheduler gateway requires PROCESS_REMINDER_LAMBDA_ARN and REMINDER_SCHEDULER_TARGET_ROLE_ARN',
    );
  }

  return {
    scheduleGroupName,
    targetLambdaArn,
    targetRoleArn,
    region: process.env.AWS_REGION ?? process.env.REGION,
  };
}

export class EventBridgeSchedulerGateway implements ReminderSchedulerGateway {
  constructor(
    private readonly client: SchedulerClient,
    private readonly config: ReminderSchedulerGatewayConfig,
  ) {}

  async register(request: RegisterReminderJobRequest): Promise<void> {
    if (!isSchedulerEligibleFireTime(request.scheduledAt)) {
      logger.warn({
        event: 'reminder_schedule_register_skipped_past',
        runtimeTaskInstanceId: request.runtimeTaskInstanceId,
        patientId: request.patientId,
        orgId: request.orgId,
        scheduledAt: request.scheduledAt,
        correlationId: request.correlationId,
        message: 'Reminder fire time is in the past or within 1 minute; schedule not created',
      });
      return;
    }

    const schedulerJobId = buildReminderScheduleName(request.runtimeTaskInstanceId);
    const scheduleInput = {
      Name: schedulerJobId,
      GroupName: this.config.scheduleGroupName,
      ScheduleExpression: toSchedulerAtExpression(request.scheduledAt),
      ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
      ActionAfterCompletion: ActionAfterCompletion.DELETE,
      State: 'ENABLED' as const,
      Target: {
        Arn: this.config.targetLambdaArn,
        RoleArn: this.config.targetRoleArn,
        Input: JSON.stringify(buildProcessReminderTargetInput(request, schedulerJobId)),
        RetryPolicy: {
          MaximumEventAgeInSeconds: 3600,
          MaximumRetryAttempts: 2,
        },
      },
    };

    try {
      await this.client.send(new UpdateScheduleCommand(scheduleInput));
      logger.info({
        event: 'reminder_schedule_updated',
        schedulerJobId,
        runtimeTaskInstanceId: request.runtimeTaskInstanceId,
        scheduledAt: request.scheduledAt,
        channel: request.channel,
        correlationId: request.correlationId,
      });
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) {
        throw error;
      }

      await this.client.send(new CreateScheduleCommand(scheduleInput));
      logger.info({
        event: 'reminder_schedule_created',
        schedulerJobId,
        runtimeTaskInstanceId: request.runtimeTaskInstanceId,
        scheduledAt: request.scheduledAt,
        channel: request.channel,
        correlationId: request.correlationId,
      });
    }
  }

  async cancel(request: CancelReminderJobRequest): Promise<void> {
    const schedulerJobId = buildReminderScheduleName(request.runtimeTaskInstanceId);

    try {
      await this.client.send(
        new DeleteScheduleCommand({
          Name: schedulerJobId,
          GroupName: this.config.scheduleGroupName,
        }),
      );
      logger.info({
        event: 'reminder_schedule_deleted',
        schedulerJobId,
        ...buildCancelLogContext(request),
      });
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        logger.info({
          event: 'reminder_schedule_delete_not_found',
          schedulerJobId,
          ...buildCancelLogContext(request),
        });
        return;
      }
      throw error;
    }
  }
}

let gateway: ReminderSchedulerGateway | undefined;
let schedulerClient: SchedulerClient | undefined;

function createSchedulerClient(config: ReminderSchedulerGatewayConfig): SchedulerClient {
  const clientConfig: SchedulerClientConfig = {};
  if (config.region) {
    clientConfig.region = config.region;
  }
  return new SchedulerClient(clientConfig);
}

export function getReminderSchedulerGateway(): ReminderSchedulerGateway {
  if (!gateway) {
    const config = readGatewayConfig();
    schedulerClient = createSchedulerClient(config);
    gateway = new EventBridgeSchedulerGateway(schedulerClient, config);
  }
  return gateway;
}

export function setReminderSchedulerGatewayForTests(
  value: ReminderSchedulerGateway | undefined,
): void {
  gateway = value;
  if (value === undefined) {
    schedulerClient = undefined;
  }
}
