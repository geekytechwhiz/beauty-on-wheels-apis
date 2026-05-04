import { EventConsumer } from '../sdk/consumer/event-consumer';
import { EventPublisher } from '../sdk/publisher/event-publisher';

import type {
  EventConsumerDeps,
  VersionedPayloadSchemas,
} from '../typings/consumer.types';
import type {
  EventPublishAdapter,
  EventPublisherDeps,
} from '../typings/publisher.types';

import { setDxRuntime } from './context';

export type ConfigureEventDxOptions = {
  /** Default service label for publisher logging. */
  serviceName: string;
  publishAdapter: EventPublishAdapter;
  /** When set, applied to publisher and merged into consumer `payloadSchemas`. */
  payloadSchemas?: VersionedPayloadSchemas;
  consumer: EventConsumerDeps;
  /** Extra deps for {@link EventPublisher} excluding adapter, schemas, serviceName. */
  publisherOptions?: Omit<
    EventPublisherDeps,
    'adapter' | 'payloadSchemas' | 'serviceName' | 'logger'
  > & {
    logger?: EventPublisherDeps['logger'];
  };
};

/**
 * Singleton wiring for DX helpers ({@link publishEvent}, {@link onEvent}).
 * Builds internal {@link EventPublisher} / {@link EventConsumer}; does not expose them.
 */
export function configureEventDx(options: ConfigureEventDxOptions): void {
  const mergedSchemas =
    options.payloadSchemas ?? options.consumer.payloadSchemas;

  const consumerDeps: EventConsumerDeps = {
    ...options.consumer,
    ...(mergedSchemas !== undefined ? { payloadSchemas: mergedSchemas } : {}),
  };

  const publisher = new EventPublisher({
    adapter: options.publishAdapter,
    payloadSchemas: mergedSchemas as unknown as NonNullable<
      EventPublisherDeps['payloadSchemas']
    >,
    serviceName: options.serviceName,
    ...options.publisherOptions,
  });

  const consumer = new EventConsumer(consumerDeps);

  setDxRuntime({ publisher, consumer });
}
