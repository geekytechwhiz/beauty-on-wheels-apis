import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { randomUUID } from 'crypto';
import { EventEnvelope } from './event.types'; 
const baseLogger = createLogger({ service: 'user-service', redactPII: true });

const topicArn = process.env.USER_EVENTS_TOPIC_ARN;
const region = process.env.DEFAULT_REGION || process.env.DP_REGION || 'us-east-1';

const sns = new SNSClient({ region });

function isNonProdRelaxed(): boolean {
  const stage = process.env.STAGE || process.env.SERVERLESS_STAGE || process.env.NODE_ENV;

  
  return (
    process.env.IS_OFFLINE === 'true' ||
    stage === 'local' ||
    stage === 'dev' ||
    stage === 'test' ||
    !stage
  );
}

export async function publishEvent<T>(evt: EventEnvelope<T>, correlationId?: string): Promise<void> {
  const finalCorrelationId = evt.correlationId || correlationId;
  const logger = createChildLogger(baseLogger, { correlationId: finalCorrelationId, eventType: evt.eventType });

  if (!topicArn) {
    logger.warn({
      event: 'events_topic_missing',
      condition: 'topic_not_configured',
      eventType: evt.eventType,
      message: 'USER_EVENTS_TOPIC_ARN not set; event not published; notifications (email/SMS) will not be sent',
    });
    return;
  }

  const envelope: EventEnvelope<T> = {
    ...evt,
    eventId: evt.eventId || randomUUID(),
    occurredAt: evt.occurredAt || new Date().toISOString(),
    correlationId: finalCorrelationId,
  };

  if (evt.eventType === 'UserCreatedNotificationRequested' && evt.data) {
    const d = evt.data as { channels?: string[]; phone?: string; userId?: string };
    logger.info({
      event: 'sns_publish_attempt_user_created',
      condition: 'before_publish',
      eventType: evt.eventType,
      userId: d.userId,
      channels: d.channels,
      hasPhone: !!d.phone,
      smsInChannels: d.channels?.includes('sms'),
      message: 'Publishing UserCreatedNotificationRequested to SNS',
    });
  }

  const message = JSON.stringify(envelope);
  logger.info({ event: 'sns_publish_attempt', condition: 'publish', message: 'Publishing event to SNS', eventType: envelope.eventType });
  try {
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Message: message,
        MessageAttributes: {
          eventType: { DataType: 'String', StringValue: envelope.eventType },
          source: { DataType: 'String', StringValue: envelope.source || 'user-service' },
        },
      }),
    );
    logger.info({
      event: 'sns_publish_success',
      condition: 'publish_ok',
      eventType: envelope.eventType,
      message: 'Event published to SNS successfully',
    });
  } catch (err: unknown) {
    const code = (err as { name?: string; code?: string })?.name || (err as { code?: string })?.code;
    const credentialErrors = [
      'UnrecognizedClientException',
      'InvalidClientTokenId',
      'SignatureDoesNotMatch',
      'AccessDeniedException',
      'InvalidAccessKeyId',
    ];
    if (isNonProdRelaxed() && credentialErrors.includes(code || '')) {
      logger.warn({
        event: 'sns_publish_skipped_nonprod_invalid_credentials',
        condition: 'credentials_error',
        eventType: envelope.eventType,
        code,
        message: (err as Error)?.message,
      });
      return;
    }
    logger.error({
      event: 'sns_publish_error',
      condition: 'publish_failed',
      eventType: envelope.eventType,
      err: serializeError(err),
      code,
      message: 'Failed to publish event to SNS',
    });
    throw err;
  }
}

