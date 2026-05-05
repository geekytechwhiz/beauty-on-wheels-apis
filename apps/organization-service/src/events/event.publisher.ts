import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { randomUUID } from 'crypto';
import { EventEnvelope } from './event.types';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

const topicArn = process.env.ORGANIZATION_EVENTS_TOPIC_ARN;
const region = process.env.DEFAULT_REGION || process.env.DP_REGION || 'us-east-1';

const sns = new SNSClient({ region });

const CREDENTIAL_OR_AUTH_ERROR_CODES = [
  'UnrecognizedClientException',
  'InvalidClientTokenId',
  'SignatureDoesNotMatch',
  'AccessDeniedException',
  'InvalidAccessKeyId',
  'ExpiredToken',
  'ExpiredTokenException',
] as const;

/**
 * Non-prod / offline: see serverless.offline.yml (STAGE, IS_OFFLINE).
 * Do not treat NODE_ENV as deployment stage — bundled handlers often set NODE_ENV=production
 * while STAGE is still `dev`.
 */
function isNonProdRelaxed(): boolean {
  if (process.env.IS_OFFLINE === 'true') {
    return true;
  }

  const stage = String(
    process.env.STAGE || process.env.SERVERLESS_STAGE || process.env.SLS_STAGE || '',
  ).toLowerCase();

  if (
    stage === 'local' ||
    stage === 'dev' ||
    stage === 'development' ||
    stage === 'test' ||
    stage === 'offline' ||
    stage === ''
  ) {
    return true;
  }

  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  return nodeEnv === 'development' || nodeEnv === 'test';
}

function resolvePublishErrorCode(err: unknown): string {
  const e = err as { name?: string; code?: string; Code?: string; message?: string };
  const fromMeta = e.code || e.Code;
  if (fromMeta && String(fromMeta) !== 'Error') return String(fromMeta);
  if (e.name && e.name !== 'Error') return e.name;
  const msg = (e.message || '').trim();
  for (const code of CREDENTIAL_OR_AUTH_ERROR_CODES) {
    if (msg === code || msg.includes(code)) return code;
  }
  return e.name || '';
}

function isCredentialOrAuthFailure(err: unknown, code: string): boolean {
  if (CREDENTIAL_OR_AUTH_ERROR_CODES.includes(code as (typeof CREDENTIAL_OR_AUTH_ERROR_CODES)[number])) {
    return true;
  }
  const msg = ((err as Error)?.message || '').trim();
  return CREDENTIAL_OR_AUTH_ERROR_CODES.some((c) => msg === c || msg.includes(c));
}

function shouldToleratePublishFailure(err: unknown, code: string): boolean {
  return isNonProdRelaxed() && isCredentialOrAuthFailure(err, code);
}

export async function publishEvent<T>(evt: EventEnvelope<T>, correlationId?: string): Promise<void> {
  const finalCorrelationId = evt.correlationId || correlationId;
  const logger = createChildLogger(baseLogger, { correlationId: finalCorrelationId, eventType: evt.eventType });

  try {
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
    const code = resolvePublishErrorCode(err);
    if (shouldToleratePublishFailure(err, code)) {
      logger.warn({
        event: 'sns_publish_skipped_nonprod_invalid_credentials',
        code,
        message: (err as Error)?.message,
      });
      return;
    }
    logger.error({
      event: 'sns_publish_error',
      err: serializeError(err),
      code,
      message: 'Failed to publish event',
    });
  }
}
