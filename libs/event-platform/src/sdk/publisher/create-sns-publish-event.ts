import { createLogger, type Logger } from '@api-hub/observability';

import type { EventEnvelope } from '../../typings/base-event.types';

import { EventPublisher } from './event-publisher';
import {
  createSnsTopicAdapter,
  isCredentialLikeSnsError,
  isNonProdRelaxed,
} from './sns-topic-adapter';
import type { PayloadSchemaRegistry } from '../../typings/consumer.types';

export type CreateSnsPublishEventOptions = {
  serviceName: string;
  /** Environment variable that holds the SNS topic ARN, e.g. `USER_EVENTS_TOPIC_ARN`. */
  topicArnEnv: string;
  defaultSource: string;
  region?: string;
  payloadSchemas?: PayloadSchemaRegistry;
  onBeforeBuild?: (params: { eventType: string; raw: unknown }) => void;
};

/**
 * Factory: shared SNS event publisher (envelope, optional schema check, publish logging, SNS send).
 * Reuses a single {@link EventPublisher} when the topic ARN env is stable.
 */
export function createSnsPublishEvent(
  options: CreateSnsPublishEventOptions,
): <T>(
  evt: Partial<EventEnvelope<T>> & { eventType: string; payload: T },
  correlationId?: string,
) => Promise<void> {
  const log: Pick<Logger, 'info' | 'warn' | 'error'> =
    createLogger({
      service: options.serviceName,
      redactPII: true,
    });

  let cachedPublisher: EventPublisher | undefined;

  function getPublisher(topicArn: string): EventPublisher {
    if (!cachedPublisher) {
      const adapter = createSnsTopicAdapter({ topicArn, region: options.region });
      cachedPublisher = new EventPublisher({
        adapter,
        payloadSchemas: options.payloadSchemas,
        serviceName: options.serviceName,
        logger: log,
      });
    }
    return cachedPublisher;
  }

  return async <T>(
    evt: Partial<EventEnvelope<T>> & { eventType: string; payload: T },
    correlationId?: string,
  ): Promise<void> => {
    options.onBeforeBuild?.({ eventType: evt.eventType, raw: evt });

    const topicArn = process.env[options.topicArnEnv];
    if (!topicArn) {
      log.warn({
        event: 'sns_topic_arn_missing',
        envKey: options.topicArnEnv,
        message: 'Skipping SNS publish — topic ARN env not set',
      });
      return;
    }

    const evtRecord = evt as Record<string, unknown>;
    const evtCorrelation =
      typeof evtRecord.correlationId === 'string' ? evtRecord.correlationId : undefined;

    const finalCorrelationId =
      evtCorrelation ?? correlationId ?? evt.meta?.correlationId;

    try {
      await getPublisher(topicArn).publish({
        eventType: evt.eventType,
        source: evt.source ?? options.defaultSource,
        version: evt.eventVersion ?? '1.0.0',
        payload: evt.payload,
        correlationId: finalCorrelationId,
        eventId: evt.eventId,
        timestamp: evt.timestamp,
        idempotencyKey: evt.idempotencyKey,
        meta: evt.meta,
      });
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      const codeFromError = (err as { code?: string })?.code;
      const messageText = (err as { message?: string })?.message;
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
      if (isNonProdRelaxed() && (credentialErrors.includes(code || '') || isCredentialLikeSnsError(err))) {
        log.warn({
          event: 'sns_publish_skipped_nonprod_invalid_credentials',
          code,
          message: messageText,
        });
        return;
      }
      log.error({
        event: 'sns_publish_error',
        err:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : { value: String(err) },
        message: 'Failed to publish event',
      });
      throw err;
    }
  };
}
