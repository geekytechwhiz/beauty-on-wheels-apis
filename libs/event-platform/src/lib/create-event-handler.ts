import type {
  Handler,
  Middleware,
  MiddlewarePipelineEvent,
} from '@api-hub/middleware';
import {
  buildEventExecutionPipeline, 
  runMiddlewares,
} from '@api-hub/middleware';

import { getLogger } from '@api-hub/observability';
import { z } from 'zod';

import type { BaseEvent } from '../typings/base-event.types';
import { DomainIdempotencyStrategy } from '../core/idempotency/domain-idempotency.strategy';
import type { EventConsumerDeps } from '../typings/consumer.types';
import type { EventTracingHooks } from '../core/tracing/event-tracing-hooks';
import type { TraceContext } from '../core/tracing/trace-context';
import { consumeEvent } from './event-platform';

 

const logger = getLogger();

type OperationName =
  `${string}.${'created' | 'updated' | 'deleted' | 'processed' | 'failed'}`;

const baseConsumerDeps: EventConsumerDeps = {
  idempotencyStrategy: new DomainIdempotencyStrategy(),
  retry: {
    maxAttempts: 3,
    strategy: 'exponential',
    delayMs: 200,
  },
  dlq: { enabled: true },
};

function mergeTracingForDispatchLog(
  existing?: EventTracingHooks,
): EventTracingHooks | undefined {
  const dispatchInfo = (ctx: TraceContext) => {
    logger.info('Dispatching event to handler', {
      eventType: ctx.eventType,
      correlationId: ctx.correlationId,
    });
  };

  if (!existing) {
    return {
      onEventReceived: dispatchInfo,
      onEventProcessed: () => { /* empty */ },
      onEventFailed: () => { /* empty */ },
    };
  }

  return {
    ...existing,
    onStart(ctx: TraceContext) {
      dispatchInfo(ctx);
      if (existing.onStart) {
        existing.onStart(ctx);
      } else {
        existing.onEventReceived(ctx);
      }
    },
  };
}

export function createEventHandler<
  TEvent extends MiddlewarePipelineEvent,
  TContext = unknown,
>(
  options: {
    operation: OperationName;
    events: {
      schema: z.ZodTypeAny & { __meta?: any };
      handler: Handler<any, void, any>;
    }[];
    consumer?: Partial<EventConsumerDeps>;
  },
): (event: TEvent, context: TContext) => Promise<void> {
  const versionedSchemas: Record<string, Record<string, z.ZodType<unknown>>> = {};
  const registry: Record<string, (event: BaseEvent<any>) => Promise<void>> = {};

  for (const e of options.events) {
    const meta = (e.schema as any).__meta;

    if (!meta?.eventType || !meta?.eventVersion) {
      throw new Error('Schema missing __meta');
    }

    if (!versionedSchemas[meta.eventType]) {
      versionedSchemas[meta.eventType] = {};
    }

    versionedSchemas[meta.eventType][meta.eventVersion] = e.schema;

    registry[meta.eventType] = async (event) => {
      await e.handler(
        {
          ...(event.payload as any),
          meta: event.meta,
        },
        {} as any,
      );
    };
  }

  const mergedDeps: EventConsumerDeps = {
    ...baseConsumerDeps,
    ...options.consumer,
    payloadSchemas: versionedSchemas,
    tracing: mergeTracingForDispatchLog(options.consumer?.tracing),
  };

  const wrappedHandler = consumeEvent(mergedDeps, registry);

  const stack = buildEventExecutionPipeline<void, TContext>({
    operation: options.operation,
  }) as Array<Middleware<TEvent, void, TContext>>;

  return runMiddlewares(
    stack,
    wrappedHandler as unknown as Handler<TEvent, void, TContext>,
  );
}
