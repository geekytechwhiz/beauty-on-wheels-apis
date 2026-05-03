import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { randomUUID } from 'crypto';
import { EventEnvelope } from './event.types';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

const topicArn = process.env.ORGANIZATION_EVENTS_TOPIC_ARN;
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
    logger.warn({ event: 'events_topic_missing', msg: 'ORGANIZATION_EVENTS_TOPIC_ARN not set' });
    return;
  }

  const envelope: EventEnvelope<T> = {
    ...evt,
    eventId: evt.eventId || randomUUID(),
    occurredAt: evt.occurredAt || new Date().toISOString(),
    correlationId: finalCorrelationId,
  };

  const message = JSON.stringify(envelope);
  logger.info({ event: 'sns_publish_attempt', message: 'Publishing event to SNS', eventEnvelope: envelope });
  try {
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Message: message,
        MessageAttributes: {
          eventType: { DataType: 'String', StringValue: envelope.eventType },
          source: { DataType: 'String', StringValue: envelope.source || 'organization-service' },
        },
      }),
    );
    logger.info({ event: 'sns_publish_success', message: 'Event published' });
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    const codeFromError = (err as { code?: string })?.code;
    const messageText = (err as { message?: string })?.message;
    // Some SDK failures surface as name="Error" while the actionable AWS reason is in message.
    const code = name && name !== 'Error' ? name : codeFromError || messageText || name;
    const credentialErrors = [
      'UnrecognizedClientException',
      'InvalidClientTokenId',
      'SignatureDoesNotMatch',
      'AccessDeniedException',
      'InvalidAccessKeyId',
      'AuthorizationError',
      'AuthorizationErrorException',
    ];
    if (isNonProdRelaxed() && credentialErrors.includes(code || '')) {
      logger.warn({
        event: 'sns_publish_skipped_nonprod_invalid_credentials',
        code,
        message: messageText,
      });
      return;
    }
    logger.error({
      event: 'sns_publish_error',
      err: serializeError(err),
      code,
      message: 'Failed to publish event',
    });
    throw err;
  }
}
