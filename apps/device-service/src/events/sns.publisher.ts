import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { randomUUID } from 'crypto';
import type { NotificationEnvelope } from './event.types';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const topicArn = process.env.NOTIFICATION_TOPIC_ARN;
const region = process.env.DEFAULT_REGION || process.env.REGION || 'us-east-1';
const sns = new SNSClient({ region });

export async function publishNotificationEvent<T>(
  eventType: string,
  data: T,
  correlationId?: string
): Promise<void> {
  const logger = createChildLogger(baseLogger, { correlationId, eventType });
  if (!topicArn) {
    logger.warn({ event: 'notification_topic_missing', msg: 'NOTIFICATION_TOPIC_ARN not set' });
    return;
  }
  const envelope: NotificationEnvelope<T> = {
    eventId: randomUUID(),
    eventType,
    occurredAt: new Date().toISOString(),
    source: 'device-service',
    correlationId,
    data,
  };
  const message = JSON.stringify(envelope);
  try {
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Message: message,
        MessageAttributes: {
          eventType: { DataType: 'String', StringValue: eventType },
          source: { DataType: 'String', StringValue: 'device-service' },
        },
      })
    );
    logger.info({ event: 'sns_publish_success', eventType });
  } catch (err) {
    logger.error({ event: 'sns_publish_error', err: serializeError(err), eventType });
    throw err;
  }
}
