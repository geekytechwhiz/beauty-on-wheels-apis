import {
  type LambdaInvocationContext,
  withLoggerContext,
  type LoggerContext,
} from '@api-hub/observability';
import type { Handler, MiddlewarePipelineEvent } from '@api-hub/middleware';

import type { RealtimeConsumerConfig } from '../core/realtime/interfaces/realtime-config.interface';
import {
  consumeEvent,
  type ConsumeEventOptions,
} from '../engine/executor/consume-event';
import type { EventConsumerDeps, VersionedPayloadSchemas } from '../typings/consumer.types';
import { validateConsumerDlqConfig } from '../infra/dlq-integration';
import {
  buildEventRegistry,
  createDefaultConsumerDeps,
  type EventHandlerEntry,
} from './build-event-registry';
import { composeEventHandlerWithMiddleware, type OperationName } from './middleware-compose';
import type { TransportProfile } from './transport-profile';
import {
  mapTransportHandlerResult,
  type TransportOutcomeMapperOptions,
} from './transport-outcome-mapper';

export type CreateConsumerRuntimeOptions<
  TEvent extends MiddlewarePipelineEvent,
  TResult,
  TContext = unknown,
> = {
  operation: string;
  profile: TransportProfile;
  events: EventHandlerEntry[];
  consumer?: Partial<EventConsumerDeps>;
  realtime?: RealtimeConsumerConfig;
  consumeOptions?: (
    lambdaContext: TContext,
  ) => ConsumeEventOptions | undefined;
  onBatchStart?: () => void;
  coerceResult?: (event: TEvent, result: unknown) => TResult | Promise<TResult>;
};

function mergeConsumerDeps(
  profile: TransportProfile,
  payloadSchemas: VersionedPayloadSchemas,
  consumer?: Partial<EventConsumerDeps>,
): EventConsumerDeps {
  const mapRawToBaseEvent =
    consumer?.mapRawToBaseEvent ??
    ((raw: unknown) => profile.mapToBaseEvent(profile.parseInbound(raw)));

  return createDefaultConsumerDeps(payloadSchemas, {
    ...consumer,
    realtime: consumer?.realtime,
    transportMode: consumer?.transportMode ?? profile.defaultTransportMode,
    transportProfile: profile,
    mapRawToBaseEvent,
    payloadSchemas,
  });
}

export function createConsumerRuntime<
  TEvent extends MiddlewarePipelineEvent,
  TResult,
  TContext = unknown,
>(
  options: CreateConsumerRuntimeOptions<TEvent, TResult, TContext>,
): (event: TEvent, context: TContext) => Promise<TResult> {
  validateConsumerDlqConfig(options.consumer);

  const { payloadSchemas, registry } = buildEventRegistry(options.events);
  const mergedDeps = mergeConsumerDeps(options.profile, payloadSchemas, {
    ...options.consumer,
    ...(options.realtime ? { realtime: options.realtime } : {}),
  });

  const outcomeOptions: TransportOutcomeMapperOptions = {
    supportsPartialBatch: options.profile.supportsPartialBatch,
  };

  const handler: Handler<TEvent, TResult, TContext> = async (event, lambdaContext) => {
    options.onBatchStart?.();
    const consumeOptions = options.consumeOptions?.(lambdaContext);
    const consumed = consumeEvent(
      mergedDeps,
      registry,
      undefined,
      consumeOptions,
    );

    const result = await consumed(event);
    if (options.coerceResult) {
      return options.coerceResult(event, result);
    }

    return mapTransportHandlerResult<TResult>(event, result, outcomeOptions);
  };

  return composeEventHandlerWithMiddleware({
    operation: options.operation as OperationName,
    handler,
    realtime: mergedDeps.realtime,
    realtimeAggregationPublisher: mergedDeps.realtimeAggregationPublisher,
  });
}

export function createPerRecordLoggerConsumeOptions<
  TContext extends LambdaInvocationContext,
>(
  profile: TransportProfile,
  operation: OperationName,
  lambdaContext: TContext,
): ConsumeEventOptions {
  return {
    wrapProcessSingle: async ({ raw, run }) => {
      if (!profile.perRecordLoggerContext) {
        return run();
      }
      const envelope = profile.parseInbound(raw);
      const ctx = profile.perRecordLoggerContext(
        envelope,
        operation,
        lambdaContext.awsRequestId,
      );
      return withLoggerContext(ctx as LoggerContext, run);
    },
  };
}
