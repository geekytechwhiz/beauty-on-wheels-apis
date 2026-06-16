import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createChildLogger, createLogger, serializeError } from '@api-hub/observability';

const baseLogger = createLogger({ service: 'task-command-publisher' });

let eventBridgeClient: EventBridgeClient | undefined;

function getEventBridgeClient(): EventBridgeClient {
  if (!eventBridgeClient) {
    eventBridgeClient = new EventBridgeClient({
      region: process.env.AWS_REGION || process.env.REGION || 'us-east-1',
    });
  }
  return eventBridgeClient;
}

export type CancelReminderJobsCommand = {
  runtimeTaskInstanceId: string;
  patientId: string;
  reason?: string;
};

export type RegisterReminderJobsCommand = {
  runtimeTaskInstanceId: string;
  patientId: string;
  reminderRecordId?: string;
  scheduledReminderAt?: number;
  reminderChannel?: string;
};

async function publishTaskCommand(
  detailType: 'CancelReminderJobs' | 'RegisterReminderJobs',
  command: CancelReminderJobsCommand | RegisterReminderJobsCommand,
  correlationId: string | undefined,
  successEvent: string,
  failureEvent: string,
): Promise<void> {
  const eventBusName = process.env.EVENT_BUS?.trim();
  if (!eventBusName) {
    baseLogger.warn({ event: 'task_event_bus_missing', message: 'EVENT_BUS not set; skip publish' });
    return;
  }

  const logger = createChildLogger(baseLogger, {
    correlationId,
    runtimeTaskInstanceId: command.runtimeTaskInstanceId,
  });

  try {
    await getEventBridgeClient().send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'task-service',
            DetailType: detailType,
            Detail: JSON.stringify(command),
            EventBusName: eventBusName,
          },
        ],
      }),
    );
    logger.info({ event: successEvent });
  } catch (err) {
    logger.error({
      event: failureEvent,
      err: serializeError(err),
    });
  }
}

export async function publishCancelReminderJobs(
  command: CancelReminderJobsCommand,
  correlationId?: string,
): Promise<void> {
  await publishTaskCommand(
    'CancelReminderJobs',
    command,
    correlationId,
    'cancel_reminder_jobs_published',
    'cancel_reminder_jobs_publish_failed',
  );
}

export async function publishRegisterReminderJobs(
  command: RegisterReminderJobsCommand,
  correlationId?: string,
): Promise<void> {
  await publishTaskCommand(
    'RegisterReminderJobs',
    command,
    correlationId,
    'register_reminder_jobs_published',
    'register_reminder_jobs_publish_failed',
  );
}
