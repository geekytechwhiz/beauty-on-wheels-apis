import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { TaskRepository, isReminderRegistrationEligible, type RuntimeTaskState } from '@api-hub/task-core';
import { createLogger, extractAwsRequestId, extractCorrelationId } from '@api-hub/observability';
import { ApiResponse, BaseError } from '@api-hub/utils';
import { z } from 'zod';

import { getNotificationGateway } from '../../reminder/notification.gateway';
import { PROCESS_REMINDER_CALLBACK_VERSION } from '../../reminder/process-reminder.contract';

const logger = createLogger({ service: 'task-service', redactPII: true });

const ProcessReminderBodySchema = z.object({
  runtimeTaskInstanceId: z.string().min(1),
  patientId: z.string().min(1),
  orgId: z.string().min(1),
  scheduledAt: z.number(),
  channel: z.string().min(1),
  schedulerJobId: z.string().optional(),
});

let taskRepository: TaskRepository | undefined;

function getTaskRepository(): TaskRepository {
  if (!taskRepository) {
    taskRepository = new TaskRepository();
  }
  return taskRepository;
}

export function setTaskRepositoryForTests(repo: TaskRepository | undefined): void {
  taskRepository = repo;
}

/**
 * Phase 3 callback — invoked by EventBridge Scheduler at fire time.
 * Validates META is still reminder-eligible before sending notification.
 */
export async function main(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  let body: unknown;
  try {
    body = event.body ? JSON.parse(event.body) : undefined;
  } catch {
    return ApiResponse.badRequest(
      [{ message: 'Invalid JSON body' }],
      { title: 'Bad Request', description: 'Request body must be valid JSON', severity: 'ERROR' },
      { correlationId },
    );
  }

  const parsed = ProcessReminderBodySchema.safeParse(body);
  if (!parsed.success) {
    return ApiResponse.badRequest(
      parsed.error.issues.map((issue) => ({ message: issue.message, field: issue.path.join('.') })),
      { title: 'Validation Error', description: 'Invalid processReminder payload', severity: 'ERROR' },
      { correlationId },
    );
  }

  const payload = parsed.data;

  logger.info({
    event: 'process_reminder_received',
    correlationId,
    awsRequestId,
    callbackVersion: PROCESS_REMINDER_CALLBACK_VERSION,
    runtimeTaskInstanceId: payload.runtimeTaskInstanceId,
    schedulerJobId: payload.schedulerJobId,
  });

  try {
    const repo = getTaskRepository();
    const lookup = await repo.getLookupByTaskId(payload.runtimeTaskInstanceId);
    if (!lookup) {
      return ApiResponse.notFound(
        [{ message: 'Runtime task not found' }],
        { title: 'Not Found', description: 'Runtime task instance not found', severity: 'ERROR' },
        { correlationId },
      );
    }

    const meta = await repo.getMetaByLookup(lookup);
    if (!meta) {
      return ApiResponse.notFound(
        [{ message: 'Runtime task META not found' }],
        { title: 'Not Found', description: 'Runtime task META not found', severity: 'ERROR' },
        { correlationId },
      );
    }

    if (meta.reminderEnabled !== true) {
      logger.info({
        event: 'process_reminder_skipped',
        reason: 'remindersDisabled',
        runtimeTaskInstanceId: payload.runtimeTaskInstanceId,
      });
      return ApiResponse.ok(
        { outcome: 'skipped', reason: 'remindersDisabled' },
        { title: 'Skipped', description: 'Reminders are disabled for this task', severity: 'INFO' },
        { correlationId },
      );
    }

    const currentState = meta.currentState as RuntimeTaskState;
    if (!isReminderRegistrationEligible(currentState)) {
      logger.info({
        event: 'process_reminder_skipped',
        reason: `taskTerminalState:${currentState}`,
        runtimeTaskInstanceId: payload.runtimeTaskInstanceId,
      });
      return ApiResponse.ok(
        { outcome: 'skipped', reason: `taskTerminalState:${currentState}` },
        { title: 'Skipped', description: 'Task is in a terminal state', severity: 'INFO' },
        { correlationId },
      );
    }

    await getNotificationGateway().sendReminder({
      runtimeTaskInstanceId: payload.runtimeTaskInstanceId,
      patientId: payload.patientId,
      orgId: payload.orgId,
      channel: payload.channel,
      scheduledAt: payload.scheduledAt,
      correlationId,
    });

    return ApiResponse.ok(
      { outcome: 'sent' },
      { title: 'OK', description: 'Reminder notification dispatched', severity: 'INFO' },
      { correlationId },
    );
  } catch (err: unknown) {
    logger.error({
      event: 'process_reminder_error',
      correlationId,
      error: err instanceof Error ? err.message : String(err),
    });

    if (err instanceof BaseError) {
      throw err;
    }

    return ApiResponse.internalError(
      [{ message: 'Failed to process reminder' }],
      { title: 'Internal Error', description: 'Failed to process reminder', severity: 'ERROR' },
      { correlationId },
    );
  }
}

export default main;
