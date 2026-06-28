import { createLogger } from '@api-hub/observability';
import type { Handler, Middleware, MiddlewarePipelineEvent } from '@api-hub/middleware';
import {
  buildEventExecutionPipeline,
  realtimeMiddleware,
  runMiddlewares,
} from '@api-hub/middleware';

import type { RealtimeConsumerConfig } from '../core/realtime/interfaces/realtime-config.interface';
import type { RealtimeAggregationPublisher } from '../core/realtime/publishers/realtime-aggregation.publisher';
import {
  drainRealtimePending,
  runWithRealtimeCollector,
} from '../core/realtime/realtime-invocation-collector';
import { RealtimeEventService } from '../core/realtime/services/realtime-event.service';

export type OperationName =
  `${string}.${'created' | 'updated' | 'deleted' | 'processed' | 'failed' | 'register' | 'cancel'}`;

const logger = createLogger();

export function composeEventHandlerWithMiddleware<
  TEvent extends MiddlewarePipelineEvent,
  TResult,
  TContext = unknown,
>(options: {
  operation: OperationName;
  handler: Handler<TEvent, TResult, TContext>;
  realtime?: RealtimeConsumerConfig;
  realtimeAggregationPublisher?: RealtimeAggregationPublisher;
}): (event: TEvent, context: TContext) => Promise<TResult> {
  const baseStack = buildEventExecutionPipeline<TResult, TContext>({
    operation: options.operation,
  }) as Array<Middleware<TEvent, TResult, TContext>>;

  const stack: Array<Middleware<TEvent, TResult, TContext>> = [...baseStack];

  if (options.realtime?.enabled) {
    const realtimeEventService = new RealtimeEventService(
      options.realtimeAggregationPublisher,
    );
    const config = options.realtime;

    stack.push(
      realtimeMiddleware<TResult, TContext>({
        isEnabled: () => config.enabled,
        getPendingEvents: () => drainRealtimePending(),
        getConfig: () => config,
        process: ({ event, config: cfg }:any) =>
          realtimeEventService.process({
            event: event as Parameters<RealtimeEventService['process']>[0]['event'],
            config: cfg as RealtimeConsumerConfig,
          }),
        logger: {
          warn: (meta:any) => logger.warn(meta),
          info: (meta:any) => logger.info(meta),
        },
        getCorrelationId: (e:any) => e.__context?.correlationId,
        getEventType: (e:any) => e.__context?.eventType,
      }) as Middleware<TEvent, TResult, TContext>,
    );
  }

  const composed = runMiddlewares(stack, options.handler);

  if (!options.realtime?.enabled) {
    return composed;
  }

  return async (event: TEvent, context: TContext) => {
    const e = event as MiddlewarePipelineEvent;
    e.__context = { ...e.__context, realtimeEnabled: true };
    return runWithRealtimeCollector(() => composed(event, context));
  };
}
