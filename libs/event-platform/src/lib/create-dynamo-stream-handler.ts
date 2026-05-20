import type { z } from 'zod';

import type {
  Handler,
  Middleware,
  MiddlewarePipelineEvent,
} from '@api-hub/middleware';
import { buildEventExecutionPipeline, runMiddlewares } from '@api-hub/middleware';
import type { Context, DynamoDBStreamEvent } from 'aws-lambda';
import {
  recordDynamoStreamBatchDispatch,
  withLoggerContext,
  type LoggerContext,
} from '@api-hub/observability';

import { DomainIdempotencyStrategy } from '../core/idempotency/domain-idempotency.strategy';
import { getSchemaMeta } from '../core/schema/schema-meta';
import {
  consumeEvent,
  type ConsumeEventOptions,
} from '../engine/executor/consume-event';
import {
  isAckedWithoutBatchFailure,
  type ProcessSingleResult,
} from '../engine/processor/process-outcomes';
import { buildDynamoStreamPerMessageLoggerContext } from '../dynamo-stream/dynamo-stream-per-message-context';
import {
  createDynamoStreamMapRawToBaseEvent,
  type DynamoStreamRoute,
} from '../dynamo-stream/map-dynamo-stream-record';
import type { BaseEvent } from '../typings/base-event.types';
import type { EventConsumerDeps, VersionedPayloadSchemas } from '../typings/consumer.types';

type DynamoStreamOperationName =
  `${string}.${'created' | 'updated' | 'deleted' | 'processed' | 'failed'}`;

export type CreateDynamoStreamHandlerEventEntry = DynamoStreamRoute & {
  handler: (
    input: z.infer<z.ZodTypeAny> & {
      meta: BaseEvent['meta'];
    },
    context: unknown,
  ) => Promise<void>;
};

export type CreateDynamoStreamHandlerOperationName = DynamoStreamOperationName;

export type CreateDynamoStreamHandlerOptions<TContext extends Context = Context> = {
    operation: DynamoStreamOperationName;

    /**
     * Optional overrides for idempotency, retry, DLQ, tracing, concurrency, etc.
     * Do not override {@link EventConsumerDeps.mapRawToBaseEvent} unless you extend the stream mapper.
     */
    consumer?: Partial<EventConsumerDeps>;

    events: CreateDynamoStreamHandlerEventEntry[];
};

export type DynamoStreamBatchResponse = {
  batchItemFailures: { itemIdentifier: string }[];
};

function coerceDynamoStreamBatchResponse(
  event: DynamoDBStreamEvent,
  result: unknown,
): DynamoStreamBatchResponse {
  if (
    result !== null &&
    typeof result === 'object' &&
    Array.isArray((result as DynamoStreamBatchResponse).batchItemFailures)
  ) {
    return result as DynamoStreamBatchResponse;
  }

  const single = result as ProcessSingleResult | undefined;
  if (!single || typeof single !== 'object' || !('outcome' in single)) {
    return { batchItemFailures: [] };
  }

  const itemIdentifier = event.Records?.[0]?.eventID ?? 'unknown';
  if (isAckedWithoutBatchFailure(single.outcome)) {
    return { batchItemFailures: [] };
  }

  return { batchItemFailures: [{ itemIdentifier }] };
}

/**
 * Lambda handler factory for **DynamoDB Streams** with the same pipeline as SQS:
 * {@link consumeEvent} → {@link processBatch} / {@link processSingle} →
 * {@link orchestratePreparedConsumerEvent}, middleware from {@link buildEventExecutionPipeline},
 * per-record ALS, typed partial batch failures (`eventID` identifiers).
 */
export function createDynamoStreamHandler<TContext extends Context = Context>(
  options: CreateDynamoStreamHandlerOptions<TContext>,
): (event: DynamoDBStreamEvent, context: TContext) => Promise<DynamoStreamBatchResponse> {
  const payloadSchemas: VersionedPayloadSchemas = {};
  const registry: Record<string, (event: BaseEvent<any>) => Promise<void>> = {};

  const routes: DynamoStreamRoute[] = [];

  for (const e of options.events) {
    const meta = getSchemaMeta(e.schema);
    payloadSchemas[meta.eventType] ??= {};
    payloadSchemas[meta.eventType][meta.eventVersion] = e.schema;

    routes.push({
      table: e.table,
      eventName: e.eventName,
      schema: e.schema,
    });

    registry[meta.eventType] = async (event: BaseEvent<any>) => {
      await e.handler(
        {
          ...(event.payload as object),
          meta: event.meta,
        } as any,
        {} as any,
      );
    };
  }

  const mapRawToBaseEvent = createDynamoStreamMapRawToBaseEvent(routes);

  const baseConsumerDeps: EventConsumerDeps = {
    payloadSchemas,

    idempotencyStrategy: new DomainIdempotencyStrategy(),

    retry: {
      maxAttempts: 5,
      strategy: 'exponential',
      delayMs: 200,
    },

    dlq: {
      enabled: true,
    },

    transportMode: 'dynamodb-stream',

    mapRawToBaseEvent,

    batchConcurrency: options.consumer?.batchConcurrency,
  };

  const mergedDeps: EventConsumerDeps = {
    ...baseConsumerDeps,
    ...options.consumer,
    transportMode:
      options.consumer?.transportMode ?? baseConsumerDeps.transportMode,
    mapRawToBaseEvent:
      options.consumer?.mapRawToBaseEvent ?? baseConsumerDeps.mapRawToBaseEvent,
    payloadSchemas,
  };

  const stack = buildEventExecutionPipeline<DynamoStreamBatchResponse, TContext>({
    operation: options.operation,
  }) as unknown as Array<
    Middleware<MiddlewarePipelineEvent, DynamoStreamBatchResponse, TContext>
  >;

  const handler: Handler<
    MiddlewarePipelineEvent,
    DynamoStreamBatchResponse,
    TContext
  > = async (event, lambdaContext) => {
    const streamEvent = event as unknown as DynamoDBStreamEvent;
    recordDynamoStreamBatchDispatch(streamEvent.Records?.length ?? 0);

    const consumeOptions: ConsumeEventOptions = {
      wrapProcessSingle: async ({ raw, run }) => {
        const ctx = buildDynamoStreamPerMessageLoggerContext({
          rawRecord: raw,
          operation: options.operation,
          lambdaAwsRequestId: lambdaContext.awsRequestId,
        });
        return withLoggerContext(ctx as LoggerContext, async () => run());
      },
    };

    const consumed = consumeEvent(
      mergedDeps,
      registry,
      undefined,
      consumeOptions,
    );

    const result = await consumed(streamEvent);
    return coerceDynamoStreamBatchResponse(streamEvent, result);
  };

  return runMiddlewares(stack, handler) as unknown as (
    event: DynamoDBStreamEvent,
    context: TContext,
  ) => Promise<DynamoStreamBatchResponse>;
}
