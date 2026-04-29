import { createLogger, type Logger } from '@api-hub/logger';

import type { EventEnvelope } from '../../core/event-envelope/base-event';
 
import { EventPublisher } from './event-publisher';
import { createSnsTopicAdapter, isCredentialLikeSnsError, isNonProdRelaxed } from './sns-topic-adapter';
import type { EventPublishAdapter } from './event-publish-adapter';
import type { PublishInput } from './publish-input';
import { PayloadSchemaRegistry } from '../../typings/consumer.types';

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
 * Reuses a single {@link createSnsTopicAdapter} for the current topic when the env is stable.
 */
export function createSnsPublishEvent(
  options: CreateSnsPublishEventOptions,
): <T>(evt: Partial<EventEnvelope<T>> & { eventType: string; payload: T }, correlationId?: string) => Promise<void> {
  const { serviceName, topicArnEnv, defaultSource, region, payloadSchemas, onBeforeBuild } = options;

  let cachedAdapter: EventPublishAdapter | undefined;
  let cachedTopic: string | undefined;

  return async <T,>(evt: Partial<EventEnvelope<T>> & { eventType: string; payload: T }, correlationId?: string) => {
    const topicArn = process.env[topicArnEnv as keyof NodeJS.ProcessEnv] as string | undefined;
    const parentLogger: Pick<Logger, 'info' | 'warn' | 'error'> = createLogger({
      service: serviceName,
      redactPII: true,
    });
    const finalCorrelationId = evt.correlationId ?? correlationId;
    const logger = parentLogger;

    if (!topicArn) {
      logger.warn({
        event: 'sns_topic_missing',
        condition: 'topic_not_configured',
        topicArnEnv,
        eventType: evt.eventType,
        correlationId: finalCorrelationId,
        message: `${topicArnEnv} not set; event not published`,
      });
      return;
    }

    if (cachedTopic !== topicArn || !cachedAdapter) {
      cachedTopic = topicArn;
      cachedAdapter = createSnsTopicAdapter({ topicArn, region });
    }

    onBeforeBuild?.({ eventType: evt.eventType, raw: evt });

    const input: PublishInput<T> = {
      eventType: evt.eventType,
      version: evt.version,
      source: evt.source ?? defaultSource,
      payload: evt.payload,
      correlationId: finalCorrelationId,
      eventId: evt.eventId,
      timestamp: evt.timestamp,
      idempotencyKey: evt.idempotencyKey,
    };

    const publisher = new EventPublisher({
      adapter: cachedAdapter,
      payloadSchemas,
      logger,
      serviceName,
    });

    try {
      await publisher.publish(input);
    } catch (err) {
      if (isNonProdRelaxed() && isCredentialLikeSnsError(err)) {
        logger.warn({
          event: 'sns_publish_skipped_nonprod_invalid_credentials',
          condition: 'credentials_error',
          eventType: evt.eventType,
          code: (err as { name?: string; code?: string })?.name,
          message: (err as Error)?.message,
        });
        return;
      }
      throw err;
    }
  };
}
