import type { Context } from 'aws-lambda';

import { withLoggerContext, type LoggerContext } from '@api-hub/observability';
import type { Handler, MiddlewarePipelineEvent } from '@api-hub/middleware';

import {
  consumeEvent,
  type ConsumeEventOptions,
} from '../engine/executor/consume-event';
import type { EventConsumerDeps } from '../typings/consumer.types';
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
  operation: OperationName;
  profile: TransportProfile;
  events: EventHandlerEntry[];
  consumer?: Partial<EventConsumerDeps>;
  consumeOptions?: (
    lambdaContext: TContext,
  ) => ConsumeEventOptions | undefined;
  coerceResult?: (event: TEvent, result: unknown) => TResult;
};

function mergeConsumerDeps(
  profile: TransportProfile,
  payloadSchemas: EventConsumerDeps['payloadSchemas'],
  consumer?: Partial<EventConsumerDeps>,
): EventConsumerDeps {
  const mapRawToBaseEvent =
    consumer?.mapRawToBaseEvent ??
    ((raw: unknown) => profile.mapToBaseEvent(profile.parseInbound(raw)));

  return createDefaultConsumerDeps(payloadSchemas, {
    transportMode: profile.defaultTransportMode,
    transportProfile: profile,
    mapRawToBaseEvent,
    ...consumer,
    transportMode: consumer?.transportMode ?? profile.defaultTransportMode,
    mapRawToBaseEvent:
      consumer?.mapRawToBaseEvent ??
      ((raw: unknown) => profile.mapToBaseEvent(profile.parseInbound(raw))),
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
  const { payloadSchemas, registry } = buildEventRegistry(options.events);
  const mergedDeps = mergeConsumerDeps(
    options.profile,
    payloadSchemas,
    options.consumer,
  );

  const outcomeOptions: TransportOutcomeMapperOptions = {
    supportsPartialBatch: options.profile.supportsPartialBatch,
  };

  const handler: Handler<TEvent, TResult, TContext> = async (event, lambdaContext) => {
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
    operation: options.operation,
    handler,
  });
}

export function createPerRecordLoggerConsumeOptions<TContext extends Context>(
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
