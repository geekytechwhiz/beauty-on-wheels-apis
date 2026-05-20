import type { z } from 'zod';

import { DomainIdempotencyStrategy } from '../core/idempotency/domain-idempotency.strategy';
import { getSchemaMeta } from '../core/schema/schema-meta';
import type { BaseEvent } from '../typings/base-event.types';
import type { EventConsumerDeps, VersionedPayloadSchemas } from '../typings/consumer.types';

export type EventHandlerEntry<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  schema: TSchema;
  handler: (
    input: z.infer<TSchema> & {
      meta: BaseEvent['meta'];
    },
    context: unknown,
  ) => Promise<void>;
};

export type BuiltEventRegistry = {
  payloadSchemas: VersionedPayloadSchemas;
  registry: Record<string, (event: BaseEvent<unknown>) => Promise<void>>;
};

export function buildEventRegistry(
  events: EventHandlerEntry[],
): BuiltEventRegistry {
  const payloadSchemas: VersionedPayloadSchemas = {};
  const registry: Record<string, (event: BaseEvent<unknown>) => Promise<void>> = {};

  for (const entry of events) {
    const meta = getSchemaMeta(entry.schema);
    payloadSchemas[meta.eventType] ??= {};
    payloadSchemas[meta.eventType][meta.eventVersion] = entry.schema;

    registry[meta.eventType] = async (event: BaseEvent<unknown>) => {
      await entry.handler(
        {
          ...(event.payload as object),
          meta: event.meta,
        } as z.infer<typeof entry.schema> & { meta: BaseEvent['meta'] },
        {},
      );
    };
  }

  return { payloadSchemas, registry };
}

export function createDefaultConsumerDeps(
  payloadSchemas: VersionedPayloadSchemas,
  overrides?: Partial<EventConsumerDeps>,
): EventConsumerDeps {
  const baseConsumerDeps: EventConsumerDeps = {
    payloadSchemas,
    idempotencyStrategy: new DomainIdempotencyStrategy(),
    retry: {
      maxAttempts: 3,
      strategy: 'exponential',
      delayMs: 200,
    },
    dlq: {
      enabled: true,
    },
  };

  return {
    ...baseConsumerDeps,
    ...(overrides ?? {}),
    payloadSchemas,
  };
}
