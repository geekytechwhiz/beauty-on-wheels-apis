import { EventTransport } from '../core/schema/define-event';

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

export type ConfigureEventPlatformOptions = {
  
  serviceName: string;
 
  transport: EventTransport;
 
  publishers: Partial<
    Record<EventTransport, EventPublishAdapter>
  >;
 
  payloadSchemas?: VersionedPayloadSchemas;
 
  consumer?: EventConsumerDeps;
 
  publisherOptions?: Omit<
    EventPublisherDeps,
    | 'adapter'
    | 'payloadSchemas'
    | 'serviceName'
    | 'logger'
  > & {
    logger?: EventPublisherDeps['logger'];
  };
};

/**
 * Singleton wiring for DX helpers
 * (`publishEvent`, `onEvent`).
 *
 * Builds internal publisher registry
 * and shared consumer runtime.
 */
export function configureEventPlatform(
  options: ConfigureEventPlatformOptions,
): void {
  // ---------------------------------------------------
  // Resolve schemas
  // ---------------------------------------------------

  const mergedSchemas =
    options.payloadSchemas ??
    options.consumer?.payloadSchemas;

  // ---------------------------------------------------
  // Create consumer runtime
  // ---------------------------------------------------

  const consumer =
    options.consumer
      ? new EventConsumer({
          ...options.consumer,

          ...(mergedSchemas !== undefined
            ? {
                payloadSchemas: mergedSchemas,
              }
            : {}),
        })
      : undefined;

  // ---------------------------------------------------
  // Build publisher registry
  // ---------------------------------------------------

  const publishers = Object.entries(
    options.publishers,
  ).reduce(
    (acc, [transport, adapter]) => {
      if (!adapter) {
        return acc;
      }

      acc[transport as EventTransport] =
        new EventPublisher({
          adapter,

          payloadSchemas:
            mergedSchemas as unknown as NonNullable<
              EventPublisherDeps['payloadSchemas']
            >,

          serviceName:
            options.serviceName,

          ...options.publisherOptions,
        });

      return acc;
    },
    {} as Partial<
      Record<EventTransport, EventPublisher>
    >,
  );

  // ---------------------------------------------------
  // Safety validation
  // ---------------------------------------------------

  if (
    Object.keys(publishers).length === 0
  ) {
    throw new Error(
      'At least one publisher must be configured.',
    );
  } 

  setDxRuntime({
    publishers,

    consumer,
  });
}