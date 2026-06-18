import { createDynamoStreamHandler } from '@api-hub/event-platform';
import { createLogger } from '@api-hub/observability';

import { getReminderSchedulerGateway } from '../../reminder/reminder-scheduler.gateway';
import { mapMetaToRegisterRequest } from '../../reminder/reminder-stream.mapper';
import { TaskMetaStreamPayloadSchema } from './task-meta-stream.schema';

const logger = createLogger({ service: 'task-service', redactPII: true });

const streamConsumerOptions = {
  retry: { maxAttempts: 3, strategy: 'exponential' as const, delayMs: 200 },
  dlq: { enabled: false },
};

export const main = createDynamoStreamHandler({
  operation: 'task.reminder.register',
  consumer: streamConsumerOptions,
  events: [
    {
      table: 'task-service',
      eventName: ['INSERT', 'MODIFY'],
      schema: TaskMetaStreamPayloadSchema,
      handler: async (payload) => {
        const request = mapMetaToRegisterRequest(payload, payload.meta.correlationId);

        if (!request) {
          logger.warn({
            event: 'register_reminder_jobs_skipped',
            runtimeTaskInstanceId: payload.runtimeTaskInstanceId,
            reminderEnabled: payload.reminderEnabled,
            currentState: payload.currentState,
            message: 'META record not eligible for reminder registration after stream filter',
          });
          return;
        }

        await getReminderSchedulerGateway().register(request);

        logger.info({
          event: 'register_reminder_jobs_ok',
          runtimeTaskInstanceId: request.runtimeTaskInstanceId,
          scheduledAt: request.scheduledAt,
          channel: request.channel,
        });
      },
    },
  ],
});
