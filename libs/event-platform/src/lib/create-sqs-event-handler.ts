import type { z } from 'zod';

import type { MiddlewarePipelineEvent } from '@api-hub/middleware';
import type { Context, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { SQSClient } from '@aws-sdk/client-sqs';

import {
  createConsumerRuntime,
  createPerRecordLoggerConsumeOptions,
} from '../runtime/create-consumer-runtime';
import type { EventHandlerEntry } from '../runtime/build-event-registry';
import type { OperationName } from '../runtime/middleware-compose';
import {
  buildSqsBatchResponseFromConsumeResult,
  sqsTransportProfile,
} from '../transports/sqs/profile';
import type { EventConsumerDeps } from '../typings/consumer.types';
import {
  resolveSqsVisibilityHeartbeatConfig,
  runWithSqsVisibilityHeartbeat,
  type SqsVisibilityHeartbeatHooks,
} from '../sqs/sqs-visibility-heartbeat';

export type CreateSqsEventHandlerVisibilityHeartbeat =
  | boolean
  | {
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
  consumer?: Partial<EventConsumerDeps>;
  events: EventHandlerEntry<z.ZodTypeAny>[];
  visibilityHeartbeat?: CreateSqsEventHandlerVisibilityHeartbeat;
  fifoGroupScheduling?: boolean;
  fifoPoisonReceiveCountThreshold?: number;
};

/** Preferred name for SQS Lambda consumers (alias of {@link createSqsEventHandler}). */
export type OnQueueOptions<TContext extends Context = Context> =
  CreateSqsEventHandlerOptions<TContext>;

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

export function createSqsEventHandler<TContext extends Context = Context>(
  options: CreateSqsEventHandlerOptions<TContext>,
): (event: SQSEvent, context: TContext) => Promise<SQSBatchResponse> {
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

  const consumer: Partial<EventConsumerDeps> = {
    ...options.consumer,
    transportMode: options.consumer?.transportMode ?? 'sqs-native',
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

  return createConsumerRuntime<MiddlewarePipelineEvent, SQSBatchResponse, TContext>({
    operation: options.operation,
    profile: sqsTransportProfile,
    events: options.events,
    consumer,
    consumeOptions: (lambdaContext) => {
      const base = createPerRecordLoggerConsumeOptions(
        sqsTransportProfile,
        options.operation,
        lambdaContext,
      );
      if (!visibilityHeartbeatOpts || !visibilitySqsClient) {
        return base;
      }
      return {
        wrapProcessSingle: async ({ raw, run }) => {
          const wrappedRun = async () => {
            const hbCfg = resolveSqsVisibilityHeartbeatConfig({
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
            });
            if (hbCfg) {
              return runWithSqsVisibilityHeartbeat(hbCfg, run);
            }
            return run();
          };
          if (!base.wrapProcessSingle) {
            return wrappedRun();
          }
          return base.wrapProcessSingle({ raw, run: wrappedRun });
        },
      };
    },
    coerceResult: (event, result) =>
      buildSqsBatchResponseFromConsumeResult(event as unknown as SQSEvent, result),
  }) as unknown as (event: SQSEvent, context: TContext) => Promise<SQSBatchResponse>;
}

/** Preferred DX name for SQS Lambda consumers. Same as {@link createSqsEventHandler}. */
export const onQueue = createSqsEventHandler;
