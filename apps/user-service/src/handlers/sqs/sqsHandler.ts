import { SQSEvent, SQSRecord } from 'aws-lambda';
import { createLogger, extractCorrelationId, serializeError, createChildLogger } from '@api-hub/logger';
import { sqsEventSchema } from '../../validation/user.validation';
import { InvalidEventError } from '../../utils/errors';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

interface ReminderMessage {
  userId: string;
  reminderType: string;
  correlationId?: string;
}

export async function userReminderEvent(event: SQSEvent): Promise<void> {
  const correlationId = extractCorrelationId(event as unknown as { headers?: Record<string, string> });
  const logger = createChildLogger(baseLogger, { correlationId });
  logger.info({ event: 'userReminderEvent_received', recordCount: event.Records.length });

  const validation = sqsEventSchema.safeParse(event);
  if (!validation.success) {
    logger.error({ event: 'userReminderEvent_validation_error', errors: validation.error });
    throw new InvalidEventError('Invalid SQS event structure');
  }

  const processedMessageIds = new Set<string>();

  for (const record of event.Records) {
    const messageId = record.messageId;

    if (processedMessageIds.has(messageId)) {
      logger.warn({ event: 'userReminderEvent_duplicate', messageId }, 'Duplicate message ignored');
      continue;
    }

    processedMessageIds.add(messageId);

    try {
      let body: ReminderMessage;
      try {
        body = JSON.parse(record.body);
      } catch (err) {
        const recordLogger = createChildLogger(baseLogger, { correlationId, messageId });
        recordLogger.error({ event: 'userReminderEvent_parse_error', err: serializeError(err) });
        continue;
      }

      const messageCorrelationId = body.correlationId || correlationId;
      const recordLogger = createChildLogger(baseLogger, { correlationId: messageCorrelationId, messageId, userId: body.userId });

      recordLogger.info(
        {
          event: 'userReminderEvent_processing',
          reminderType: body.reminderType,
        },
        'Processing reminder message',
      );

      if (!body.userId || !body.reminderType) {
        recordLogger.warn(
          { event: 'userReminderEvent_invalid_body', body },
          'Invalid reminder message body',
        );
        continue;
      }

      recordLogger.info(
        {
          event: 'userReminderEvent_success',
          reminderType: body.reminderType,
        },
        'Reminder processed successfully',
      );
    } catch (err) {
      const recordLogger = createChildLogger(baseLogger, { correlationId, messageId });
      recordLogger.error(
        { event: 'userReminderEvent_error', err: serializeError(err) },
        'Failed to process reminder message',
      );
    }
  }
}

