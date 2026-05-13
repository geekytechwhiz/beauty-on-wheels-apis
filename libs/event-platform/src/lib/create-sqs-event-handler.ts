import type { z } from 'zod';

import type {
  Handler,
  Middleware,
  MiddlewarePipelineEvent,
} from '@api-hub/middleware';
import { buildEventExecutionPipeline, runMiddlewares } from '@api-hub/middleware';
import type { Context, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { SQSClient } from '@aws-sdk/client-sqs';
import { withLoggerContext, type LoggerContext } from '@api-hub/observability';

import { DomainIdempotencyStrategy } from '../core/idempotency/domain-idempotency.strategy';
import {
  consumeEvent,
  type ConsumeEventOptions,
} from '../engine/executor/consume-event';
import {
  isAckedWithoutBatchFailure,
  type ProcessSingleResult,
} from '../engine/processor/process-outcomes';
import { parseInboundEvent } from '../sdk/consumer/parse-inbound-event';
import type { BaseEvent } from '../typings/base-event.types';
import type { EventConsumerDeps, VersionedPayloadSchemas } from '../typings/consumer.types';

import { getSchemaMeta } from '../core/schema/schema-meta';
import {
  resolveSqsVisibilityHeartbeatConfig,
  runWithSqsVisibilityHeartbeat,
  type SqsVisibilityHeartbeatHooks,
} from '../sqs/sqs-visibility-heartbeat';
import { buildSqsPerMessageLoggerContext } from './sqs-per-message-context';

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

/**
 * Optional SQS visibility heartbeat for long-running handlers.
 * When `true`, resolves queue URL from `SQS_QUEUE_URL` or `SQS_QUEUE` env vars.
 */
export type CreateSqsEventHandlerVisibilityHeartbeat =
  | boolean
  | {
      /** Set `false` to disable while keeping other defaults for future toggles. */
      enabled?: boolean;
      queueUrl?: string;
      client?: SQSClient;
      region?: string;
      visibilityExtensionSeconds?: number;
      heartbeatIntervalMs?: number;
      minRemainingMsToExtend?: number;
      minRemainingMsHardStop?: number;
      hooks?: SqsVisibilityHeartbeatHooks;
    };

export type CreateSqsEventHandlerOptions<TContext extends Context = Context> = {
  operation: OperationName;

  /**
   * Optional overrides for idempotency, retry, DLQ, tracing, concurrency, etc.
   * When {@link EventConsumerDeps.mapRawToBaseEvent} is omitted, the runtime uses
   * {@link parseInboundEvent} (SQS body + SNS unwrap + BaseEvent validation + optional legacy map).
   */
  consumer?: Partial<EventConsumerDeps>;

  events: EventHandlerEntry<z.ZodTypeAny>[];

  /**
   * Periodically extends SQS visibility while a message is processed (per concurrent record).
   * Uses {@link Context.getRemainingTimeInMillis} to stop before Lambda freeze.
   */
  visibilityHeartbeat?: CreateSqsEventHandlerVisibilityHeartbeat;

  /**
   * Shorthand for `consumer.sqsFifoGroupScheduling` — serializes same FIFO `MessageGroupId` within a batch
   * while respecting `consumer.batchConcurrency` across groups.
   */
  fifoGroupScheduling?: boolean;

  /**
   * Shorthand for `consumer.sqsFifoPoisonReceiveCountThreshold` (requires FIFO group scheduling).
   */
  fifoPoisonReceiveCountThreshold?: number;
};

/**
 * Coerces {@link consumeEvent} output to the Lambda `SQSBatchResponse` contract.
 * Batch invokes always return `{ batchItemFailures }`; single-record invokes are normalized too.
 */
function coerceConsumeResultToSqsBatchResponse(
  event: SQSEvent,
  result: unknown,
): SQSBatchResponse {
  if (
    result !== null &&
    typeof result === 'object' &&
    Array.isArray((result as SQSBatchResponse).batchItemFailures)
  ) {
    return result as SQSBatchResponse;
  }

  const single = result as ProcessSingleResult | undefined;
  if (!single || typeof single !== 'object' || !('outcome' in single)) {
    return { batchItemFailures: [] };
  }

  const itemIdentifier = event.Records?.[0]?.messageId ?? 'unknown';
  if (isAckedWithoutBatchFailure(single.outcome)) {
    return { batchItemFailures: [] };
  }

  return { batchItemFailures: [{ itemIdentifier }] };
}

function normalizeVisibilityHeartbeatInput(
  input: CreateSqsEventHandlerOptions['visibilityHeartbeat'],
):
  | {
      queueUrl: string;
      client?: SQSClient;
      region?: string;
      visibilityExtensionSeconds?: number;
      heartbeatIntervalMs?: number;
      minRemainingMsToExtend?: number;
      minRemainingMsHardStop?: number;
      hooks?: SqsVisibilityHeartbeatHooks;
    }
  | null {
  if (input === undefined || input === false) {
    return null;
  }
  const cfg = input === true ? {} : input;
  if (cfg.enabled === false) {
    return null;
  }
  const queueUrl =
    (typeof cfg.queueUrl === 'string' && cfg.queueUrl.trim()) ||
    (typeof process.env.SQS_QUEUE_URL === 'string' &&
      process.env.SQS_QUEUE_URL.trim()) ||
    (typeof process.env.SQS_QUEUE === 'string' && process.env.SQS_QUEUE.trim()) ||
    '';
  if (!queueUrl) {
    return null;
  }
  return {
    queueUrl,
    client: cfg.client,
    region: cfg.region,
    visibilityExtensionSeconds: cfg.visibilityExtensionSeconds,
    heartbeatIntervalMs: cfg.heartbeatIntervalMs,
    minRemainingMsToExtend: cfg.minRemainingMsToExtend,
    minRemainingMsHardStop: cfg.minRemainingMsHardStop,
    hooks: cfg.hooks,
  };
}

/**
 * Lambda handler factory for **SQS** triggers with **partial batch failure** reporting,
 * transport-safe parsing (including **SNS → SQS** subscription envelopes), and **per-message**
 * observability context (AsyncLocalStorage) for safe concurrent batches.
 *
 * Reuses {@link consumeEvent} → {@link processBatch} / {@link processSingle} →
 * {@link orchestratePreparedConsumerEvent} — **no duplicated orchestration**.
 *
 * @example
 * ```ts
 * export const handler = createSqsEventHandler({
 *   operation: 'alert.created',
 *   events: [
 *     {
 *       schema: AlertCreatedSchema,
 *       handler: async (event) => {
 *         // business logic only
 *       },
 *     },
 *   ],
 * });
 * ```
 */
export function createSqsEventHandler<TContext extends Context = Context>(
  options: CreateSqsEventHandlerOptions<TContext>,
): (event: SQSEvent, context: TContext) => Promise<SQSBatchResponse> {
  const payloadSchemas: VersionedPayloadSchemas = {};

  const registry: Record<string, (event: BaseEvent<any>) => Promise<void>> = {};

  for (const e of options.events) {
    const meta = getSchemaMeta(e.schema);

    payloadSchemas[meta.eventType] ??= {};
    payloadSchemas[meta.eventType][meta.eventVersion] = e.schema;

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

    /**
     * Native SQS redrive + partial batch failures (see {@link effectiveTransportMode}).
     */
    transportMode: 'sqs-native',

    /**
     * SQS record → {@link BaseEvent} via shared transport normalization + validation.
     * Callers may override via `consumer.mapRawToBaseEvent` for legacy wire formats.
     */
    mapRawToBaseEvent:
      options.consumer?.mapRawToBaseEvent ??
      ((raw: unknown) => parseInboundEvent(raw)),

    batchConcurrency: options.consumer?.batchConcurrency,

    ...(options.fifoGroupScheduling !== undefined
      ? { sqsFifoGroupScheduling: options.fifoGroupScheduling }
      : {}),
    ...(options.fifoPoisonReceiveCountThreshold !== undefined
      ? {
          sqsFifoPoisonReceiveCountThreshold:
            options.fifoPoisonReceiveCountThreshold,
        }
      : {}),
  };

  const mergedDeps: EventConsumerDeps = {
    ...baseConsumerDeps,
    ...options.consumer,
    transportMode: options.consumer?.transportMode ?? baseConsumerDeps.transportMode,
    mapRawToBaseEvent:
      options.consumer?.mapRawToBaseEvent ?? baseConsumerDeps.mapRawToBaseEvent,
    payloadSchemas,
  };

  const visibilityHeartbeatOpts =
    normalizeVisibilityHeartbeatInput(options.visibilityHeartbeat);

  let visibilitySqsClient: SQSClient | undefined;
  if (visibilityHeartbeatOpts) {
    visibilitySqsClient =
      visibilityHeartbeatOpts.client ??
      new SQSClient(
        visibilityHeartbeatOpts.region ?? process.env.AWS_REGION
          ? {
              region:
                visibilityHeartbeatOpts.region ??
                (process.env.AWS_REGION as string),
            }
          : {},
      );
  }

  const stack = buildEventExecutionPipeline<SQSBatchResponse, TContext>({
    operation: options.operation,
  }) as Array<
    Middleware<MiddlewarePipelineEvent, SQSBatchResponse, TContext>
  >;

  const handler: Handler<
    MiddlewarePipelineEvent,
    SQSBatchResponse,
    TContext
  > = async (event, lambdaContext) => {
    const consumeOptions: ConsumeEventOptions = {
      wrapProcessSingle: async ({ raw, run }) => {
        const ctx = buildSqsPerMessageLoggerContext({
          rawRecord: raw,
          operation: options.operation,
          lambdaAwsRequestId: lambdaContext.awsRequestId,
        });
        return withLoggerContext(ctx as LoggerContext, async () => {
          const hbCfg =
            visibilityHeartbeatOpts && visibilitySqsClient
              ? resolveSqsVisibilityHeartbeatConfig({
                  rawRecord: raw,
                  queueUrl: visibilityHeartbeatOpts.queueUrl,
                  getRemainingTimeInMillis: () =>
                    lambdaContext.getRemainingTimeInMillis(),
                  hooks: visibilityHeartbeatOpts.hooks,
                  visibilityExtensionSeconds:
                    visibilityHeartbeatOpts.visibilityExtensionSeconds,
                  heartbeatIntervalMs: visibilityHeartbeatOpts.heartbeatIntervalMs,
                  minRemainingMsToExtend:
                    visibilityHeartbeatOpts.minRemainingMsToExtend,
                  minRemainingMsHardStop:
                    visibilityHeartbeatOpts.minRemainingMsHardStop,
                  client: visibilitySqsClient,
                  region:
                    visibilityHeartbeatOpts.region ?? process.env.AWS_REGION,
                })
              : null;
          if (hbCfg) {
            return runWithSqsVisibilityHeartbeat(hbCfg, run);
          }
          return run();
        });
      },
    };

    const consumed = consumeEvent(
      mergedDeps,
      registry,
      undefined,
      consumeOptions,
    );

    const sqsEvent = event as unknown as SQSEvent;
    const result = await consumed(sqsEvent);
    return coerceConsumeResultToSqsBatchResponse(sqsEvent, result);
  };

  return runMiddlewares(stack, handler) as unknown as (
    event: SQSEvent,
    context: TContext,
  ) => Promise<SQSBatchResponse>;
}
