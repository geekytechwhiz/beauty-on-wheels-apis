import type { z } from 'zod';

import {
  buildEventExecutionPipeline,
  runMiddlewares,
} from '@api-hub/middleware';

import type {
  Handler,
  Middleware,
  MiddlewarePipelineevent: any,
} from '@api-hub/middleware';

import { consumeEvent } from '../engine/executor/consume-event';

import { DomainIdempotencyStrategy } from '../core/idempotency/domain-idempotency.strategy';

import type { BaseEvent } from '../typings/base-event.types';
import type { EventConsumerDeps } from '../typings/consumer.types';
import type { VersionedPayloadSchemas } from '../typings/consumer.types';

import { getSchemaMeta } from '../core/schema/schema-meta';

type EventHandlerEntry<TSchema extends z.ZodTypeAny> = {
  schema: TSchema;

  handler: (
    input: z.infer<TSchema> & {
      meta: BaseEvent['meta'];
    },
    context: unknown,
  ) => Promise<void>;
};

type OperationName =
  `${string}.${'created' | 'updated' | 'deleted' | 'processed' | 'failed'}`;

export type CreateEventHandlerOptions<
  TEvent extends MiddlewarePipelineevent: any,
  TContext = unknown,
> = {
  operation: OperationName;

  consumer?: Partial<EventConsumerDeps>;

  events: EventHandlerEntry<z.ZodTypeAny>[];
};

export function createEventHandler<
  TEvent extends MiddlewarePipelineevent: any,
  TContext = unknown,
>(
  options: CreateEventHandlerOptions<Tevent: any, TContext>,
): (event: Tevent: any, context: TContext) => Promise<void> {
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
  };

  /**
   * ---------------------------------------------------------------------
   * Merge user overrides
   * ---------------------------------------------------------------------
   */
  const mergedDeps: EventConsumerDeps = {
    ...baseConsumerDeps,
    ...(options.consumer ?? {}),
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
      Middleware<Tevent: any, void, TContext>
    >;

  /**
   * ---------------------------------------------------------------------
   * Compose middleware + handler
   * ---------------------------------------------------------------------
   */
  return runMiddlewares(
    stack,
    wrappedHandler as unknown as Handler<
      Tevent: any,
      void,
      TContext
    >,
  );
}