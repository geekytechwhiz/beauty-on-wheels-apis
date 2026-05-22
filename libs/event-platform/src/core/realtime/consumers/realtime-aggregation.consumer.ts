import type { LambdaInvocationContext } from '@api-hub/observability';
import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';

import { getSqsRecordShape } from '../../../lib/sqs-per-message-context';
import { createConsumerRuntime, createPerRecordLoggerConsumeOptions } from '../../../runtime/create-consumer-runtime';
import {
  buildSqsBatchResponseFromConsumeResult,
  sqsTransportProfile,
} from '../../../transports/sqs/profile';
import { createDefaultSqsDlqStrategy } from '../../../infra/dlq-integration';
import type { EventConsumerDeps } from '../../../typings/consumer.types';
import type { MiddlewarePipelineEvent } from '@api-hub/middleware';
import type { RealtimePublisher } from '../interfaces/realtime-publisher.interface';
import { resolveInfrastructureRealtimePublisher } from '../services/resolve-infrastructure-realtime-publisher';
import { RealtimeAggregateEventSchema } from '../schemas/realtime-aggregate.event';
import { RealtimeAggregationService } from '../services/realtime-aggregation.service';
import {
  getAggregationMessageId,
  runWithAggregationRecordContext,
} from './realtime-aggregation-record-context';
import {
  mergeBatchFailures,
  RealtimeAggregationBatchCollector,
  toAggregateMessage,
} from './realtime-aggregation-batch-collector';

export type CreateRealtimeAggregationConsumerOptions = {
  realtimePublisher?: RealtimePublisher;
  aggregationService?: RealtimeAggregationService;
  consumer?: Partial<EventConsumerDeps>;
};
export function createDefaultRealtimeAggregationConsumerOptions(): Partial<EventConsumerDeps> {
  const dlqStrategy = createDefaultSqsDlqStrategy();

  return {
    batchConcurrency: 5,
    retry: { maxAttempts: 3, strategy: 'exponential', delayMs: 200 },
    dlq: dlqStrategy ? { enabled: true, strategy: dlqStrategy } : { enabled: false },
  };
}

export function createDefaultRealtimeAggregationConsumer<
  TContext extends LambdaInvocationContext = LambdaInvocationContext,
>() {
  return createRealtimeAggregationConsumer<TContext>({
    consumer: createDefaultRealtimeAggregationConsumerOptions(),
  });
}

export function createRealtimeAggregationConsumer<
  TContext extends LambdaInvocationContext = LambdaInvocationContext,
>(deps: CreateRealtimeAggregationConsumerOptions = {}): (
  event: SQSEvent,
  context: TContext,
) => Promise<SQSBatchResponse> {
  const batchCollector = new RealtimeAggregationBatchCollector();
  let aggregationService: RealtimeAggregationService | undefined;

  const getAggregationService = (): RealtimeAggregationService => {
    if (!aggregationService) {
      const realtimePublisher =
        deps.realtimePublisher ?? resolveInfrastructureRealtimePublisher();
      aggregationService =
        deps.aggregationService ??
        new RealtimeAggregationService(realtimePublisher);
    }
    return aggregationService;
  };

  const defaultConsumer = createDefaultRealtimeAggregationConsumerOptions();

  return createConsumerRuntime<MiddlewarePipelineEvent, SQSBatchResponse, TContext>({
    operation: 'realtime.processed',
    profile: sqsTransportProfile,
    consumer: {
      ...defaultConsumer,
      ...deps.consumer,
    },
    onBatchStart: () => batchCollector.reset(),
    events: [
      {
        schema: RealtimeAggregateEventSchema,
        handler: async (payload: any) => {
          const messageId = getAggregationMessageId();
          if (!messageId) {
            throw new Error('Missing messageId in aggregation consumer context');
          }
          batchCollector.record(messageId, toAggregateMessage(payload));
        },
      },
    ],
    consumeOptions: (lambdaContext) => ({
      wrapProcessSingle: async ({ raw, run }) => {
        const record = getSqsRecordShape(raw);
        const messageId = record?.messageId ?? 'unknown';
        const base = createPerRecordLoggerConsumeOptions(
          sqsTransportProfile,
          'realtime.processed',
          lambdaContext,
        );
        const wrappedRun = () => runWithAggregationRecordContext(messageId, run);
        if (!base.wrapProcessSingle) {
          return wrappedRun();
        }
        return base.wrapProcessSingle({ raw, run: wrappedRun });
      },
    }),
    coerceResult: async (event, result) => {
      const response = buildSqsBatchResponseFromConsumeResult(
        event as unknown as SQSEvent,
        result,
      );
      try {
        await getAggregationService().groupAndPublish(batchCollector.drain());
      } catch {
        return mergeBatchFailures(response, batchCollector.messageIds());
      }
      return response;
    },
  }) as unknown as (event: SQSEvent, context: TContext) => Promise<SQSBatchResponse>;
}
