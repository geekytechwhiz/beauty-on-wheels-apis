import type { EventTransport } from '../core/schema/define-event';

import { EventPublisher } from '../sdk/publisher/event-publisher';

import type { VersionedPayloadSchemas } from '../typings/consumer.types';

import type {
  EventPublishAdapter,
  EventPublisherDeps,
} from '../typings/publisher.types';

import { setDxRuntime } from './context';

export type ConfigureEventPlatformOptions = {
  publishers: Partial<Record<EventTransport, EventPublishAdapter>>;
  payloadSchemas?: VersionedPayloadSchemas;
  publisherOptions?: Omit<
    EventPublisherDeps,
    'adapter' | 'payloadSchemas' | 'logger'
  > & {
    logger?: EventPublisherDeps['logger'];
  };
};

/**
 * Singleton wiring for DX publish helpers (`publishEvent`).
 */
export function configureEventPlatform(
  options: ConfigureEventPlatformOptions,
): void {
  const payloadSchemas = options.payloadSchemas;

  const publishers = Object.entries(options.publishers).reduce(
    (acc, [transport, adapter]) => {
      if (!adapter) {
        return acc;
      }

      acc[transport as EventTransport] = new EventPublisher({
        adapter,
        payloadSchemas:
          payloadSchemas as unknown as NonNullable<
            EventPublisherDeps['payloadSchemas']
          >,
        ...options.publisherOptions,
      });

      return acc;
    },
    {} as Partial<Record<EventTransport, EventPublisher>>,
  );

  if (Object.keys(publishers).length === 0) {
    throw new Error('At least one publisher must be configured.');
  }

  setDxRuntime({ publishers });
}
