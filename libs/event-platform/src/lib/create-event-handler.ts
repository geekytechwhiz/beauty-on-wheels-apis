import type {
  Handler,
  Middleware,
  MiddlewarePipelineEvent,
} from '@api-hub/middleware';
import {
  buildEventExecutionPipeline,
  ensureObservabilityInitialized,
  runMiddlewares,
} from '@api-hub/middleware';

import { createLogger } from '@api-hub/observability';
import { z } from 'zod';

import type { BaseEvent } from '../typings/base-event.types';
import { DomainIdempotencyStrategy } from '../core/idempotency/domain-idempotency.strategy';
import { EventConsumerDeps } from '../typings/consumer.types';
import { buildInternalMapper } from '../utils/helpers';
import { consumeEvent } from './event-platform';

ensureObservabilityInitialized();

const logger = createLogger();

/** -----------------------------
 * 🔹 New Types
 * ----------------------------- */
 
type VersionedEventSchema = {
  name: string;
  versions: Record<string, z.ZodType<unknown>>;
};

type EventConfig = VersionedEventSchema | VersionedEventSchema[];

/** -----------------------------
 * 🔹 Defaults
 * ----------------------------- */
const idempotencyStrategy = new DomainIdempotencyStrategy();

const baseConsumerDeps: EventConsumerDeps = {
  idempotencyStrategy,
  retry: {
    maxAttempts: 3,
    strategy: 'exponential',
    delayMs: 200,
  },
  dlq: { enabled: true },
};

/** -----------------------------
 * 🔹 Helpers
 * ----------------------------- */

/**
 * Normalize event config → Record<string, schema>
 */
function normalizeEventSchemas(events?: EventConfig) {
  if (!events) return undefined;

  const list = Array.isArray(events) ? events : [events];

  return {
    versioned: Object.fromEntries(
      list.map((e) => [e.name, e.versions]),
    ),
  };
}
function buildFlatSchemaMap(
  versionedMap: Record<string, Record<string, z.ZodType<unknown>>>,
) {
  const flat: Record<string, z.ZodType<unknown>> = {};

  for (const eventName in versionedMap) {
    const versions = versionedMap[eventName];

    // default to latest or v1
    const latestVersion =
    Object.keys(versions)
      .sort((a, b) => Number(a.replace('v', '')) - Number(b.replace('v', '')))
      .slice(-1)[0] || 'v1';

    flat[eventName] = versions[latestVersion];
  }

  return flat;
}

type OperationName =
`${string}.${'created' | 'updated' | 'deleted' | 'processed' | 'failed'}`;

export function createEventHandler<
TEvent extends MiddlewarePipelineEvent,
TContext = unknown,
>(
options: {
  operation: OperationName;
  events?: EventConfig;
  mapRawToBaseEvent?: (raw: unknown) => BaseEvent<unknown>;
  eventBridgeSource?: string;
  consumer?: Partial<EventConsumerDeps>;
},
handler: Handler<TEvent, void, TContext>,
): (event: TEvent, context: TContext) => Promise<void> {

const normalized = normalizeEventSchemas(options.events);
const versionedMap = normalized?.versioned;

const flatSchemaMap = versionedMap
  ? buildFlatSchemaMap(versionedMap)
  : undefined;

const autoMapper =
  !options.mapRawToBaseEvent &&
  versionedMap &&
  options.eventBridgeSource
    ? buildInternalMapper(versionedMap, options.eventBridgeSource)
    : undefined;

const mergedConsumerDeps: EventConsumerDeps = {
  ...baseConsumerDeps,
  ...options.consumer,
  ...(flatSchemaMap ? { payloadSchemas: flatSchemaMap } : {}),
  mapRawToBaseEvent:
    options.mapRawToBaseEvent ?? autoMapper,
};

const wrappedHandler = consumeEvent(
  mergedConsumerDeps,
  async (event) => {
    logger.info({
      event: 'event_handler_dispatch',
      message: 'Consumed domain event',
      operation: options.operation,
      correlationId: event.meta.correlationId,
      eventVersion: event.eventVersion,
    });

    await handler(
      {
        ...(event.payload as object as TEvent),
        meta: event.meta,
      } as TEvent,
      {} as TContext,
    );
  },
);

const stack = buildEventExecutionPipeline<void, TContext>({
  operation: options.operation,
}) as Array<Middleware<TEvent, void, TContext>>;

return runMiddlewares(
  stack,
  wrappedHandler as unknown as Handler<TEvent, void, TContext>,
);
}
 