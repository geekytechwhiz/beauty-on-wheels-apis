import { createLogger, type Logger } from '@api-hub/logger';

import type { EventEnvelope } from '../../typings/base-event.types';
 
import { EventPublisher } from './event-publisher';
import { createSnsTopicAdapter, isCredentialLikeSnsError, isNonProdRelaxed } from './sns-topic-adapter';
import type { EventPublishAdapter } from './event-publish-adapter';
import type { PublishInput } from '../../typings/publisher.types';
import { PayloadSchemaRegistry } from '../../typings/consumer.types';
import { createSnsPublishEvent } from "@api-hub/event-platform";

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

            const publish = createSnsPublishEvent({
              topicArnEnvKey: 'USER_EVENTS_TOPIC_ARN'
            });

            await publish(EVENT_DEFINITION, {
              payload: event,
              meta: {
                correlationId: event?.correlationId,
                tenantId: event?.tenantId,
              }
            });
          
}
