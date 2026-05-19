import type { z } from 'zod';

import { buildEventExecutionPipeline, Handler, runMiddlewares, type Middleware, type MiddlewarePipelineEvent } from '@api-hub/middleware';

import { consumeEvent } from '../engine/executor/consume-event';

import { DomainIdempotencyStrategy } from '../core/idempotency/domain-idempotency.strategy';
import { parseInboundEvent } from '../sdk/consumer/parse-inbound-event';

import type { BaseEvent } from '../typings/base-event.types';
import type { EventConsumerDeps, VersionedPayloadSchemas } from '../typings/consumer.types';
import { OperationName } from '../runtime/middleware-compose';
import { EventHandlerEntry } from '../runtime/build-event-registry';
import { getSchemaMeta } from '../core/schema/schema-meta';

export type CreateEventHandlerOptions<
  TEvent extends MiddlewarePipelineEvent,
  TContext = unknown,
> = {
  operation: OperationName;
  consumer?: Partial<EventConsumerDeps>;
  events: EventHandlerEntry<z.ZodTypeAny>[];
};

export function createEventHandler<
  TEvent extends MiddlewarePipelineEvent,
  TContext = unknown,
>(
  options: CreateEventHandlerOptions<TEvent, TContext>,
): (event: TEvent, context: TContext) => Promise<void> {
  /**
   * ---------------------------------------------------------------------
   * Build payload schema registry
   * ---------------------------------------------------------------------
   */
  const payloadSchemas: VersionedPayloadSchemas = {};

  /**
   * ---------------------------------------------------------------------
   * Registry of handlers by eventType
   * ---------------------------------------------------------------------
   */
  const registry: Record<
    string,
    (event: BaseEvent<any>) => Promise<void>
  > = {};

  for (const e of options.events) {
    const meta = getSchemaMeta(e.schema);

    payloadSchemas[meta.eventType] ??= {};
    payloadSchemas[meta.eventType][meta.eventVersion] = e.schema;

    registry[meta.eventType] = async (
      event: BaseEvent<any>,
    ) => {
      /**
       * Runtime shape:
       * handler receives flattened payload + meta
       */
      await e.handler(
        {
          ...(event.payload as object),
          meta: event.meta,
        } as any,
        {} as any,
      );
    };
  }

  /**
   * ---------------------------------------------------------------------
   * Default consumer dependencies
   * ---------------------------------------------------------------------
   */
  const baseConsumerDeps: EventConsumerDeps = {
    payloadSchemas,

    idempotencyStrategy:
      new DomainIdempotencyStrategy(),

    retry: {
      maxAttempts: 3,
      strategy: 'exponential',
      delayMs: 200,
    },

    dlq: {
      enabled: true,
    },

    mapRawToBaseEvent:
      options.consumer?.mapRawToBaseEvent ??
      ((raw: unknown) => parseInboundEvent(raw)),
  };

  /**
   * ---------------------------------------------------------------------
   * Merge user overrides
   * ---------------------------------------------------------------------
   */
  const mergedDeps: EventConsumerDeps = {
    ...baseConsumerDeps,
    ...(options.consumer ?? {}),
    mapRawToBaseEvent:
      options.consumer?.mapRawToBaseEvent ?? baseConsumerDeps.mapRawToBaseEvent,
  };

  /**
   * ---------------------------------------------------------------------
   * Wrapped event executor
   * ---------------------------------------------------------------------
   */
  const wrappedHandler = consumeEvent(
    mergedDeps,
    registry,
  );

  /**
   * ---------------------------------------------------------------------
   * Build middleware pipeline
   * ---------------------------------------------------------------------
   *
   * contextMiddleware
   * invocationContextMiddleware
   * loggerMiddleware
   * tracerMiddleware
   * performanceMiddleware
   *
   * No HTTP schema middleware here.
   */
  const stack =
    buildEventExecutionPipeline<void, TContext>({
      operation: options.operation,
    }) as Array<
      Middleware<TEvent, void, TContext>
    >;

  /**
   * ---------------------------------------------------------------------
   * Compose middleware + handler
   * ---------------------------------------------------------------------
   */
  return runMiddlewares(
    stack,
    wrappedHandler as unknown as Handler<
      TEvent,
      void,
      TContext
    >,
  );
}
