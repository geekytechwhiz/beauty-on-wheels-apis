import { createDynamoStreamHandler } from '@api-hub/event-platform';
import { createLogger } from '@api-hub/observability';

import { getReminderSchedulerGateway } from '../../reminder/reminder-scheduler.gateway';
import { mapMetaToCancelRequest } from '../../reminder/reminder-stream.mapper';
import { TaskMetaStreamPayloadSchema } from './task-meta-stream.schema';

const logger = createLogger({ service: 'task-service', redactPII: true });

const streamConsumerOptions = {
  retry: { maxAttempts: 3, strategy: 'exponential' as const, delayMs: 200 },
  dlq: { enabled: false },
};

export const main = createDynamoStreamHandler({
  operation: 'task.reminder.cancel',
  consumer: streamConsumerOptions,
  events: [
    {
      table: 'task-service',
      eventName: ['MODIFY'],
      schema: TaskMetaStreamPayloadSchema,
      handler: async (payload) => {
        const request = mapMetaToCancelRequest(payload);

        await getReminderSchedulerGateway().cancel(request);

        logger.info({
          event: 'cancel_reminder_jobs_ok',
          runtimeTaskInstanceId: request.runtimeTaskInstanceId,
          reason: request.reason,
        });
      },
    },
  ],
});
