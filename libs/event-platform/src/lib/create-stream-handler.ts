import type { DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';
import { runMiddlewares } from '@api-hub/middleware';
import { buildEventExecutionPipeline } from '@api-hub/middleware';
import type { Handler, Middleware } from '@api-hub/middleware';

import type { Baseevent: any, EventMeta } from '../typings/base-event.types';
import type { EventConsumerDeps } from '../typings/consumer.types';
import { EventConsumer } from '../sdk/consumer/event-consumer';

type StreamOrDdbRecord = {
  messageId?: string;
  eventID?: string;
  sequenceNumber?: string;
};

function itemIdentifierFromStreamRecord(record: unknown): string {
  if (record !== null && typeof record === 'object') {
    const r = record as StreamOrDdbRecord;
    return r.messageId ?? r.eventID ?? r.sequenceNumber ?? 'unknown';
  }
  return 'unknown';
}

/**
 * DynamoDB Streams: observability middleware + per-record {@link EventConsumer} processing.
 * Map each record to a {@link BaseEvent} (or skip with `null`) so idempotency / schema / retry apply per item.
 */
export function createStreamHandler<
  TResult = { batchItemFailures: { itemIdentifier: string }[] },
  TContext = unknown,
>(
  options: {
    operation: string;
    mapRecordToBaseEvent: (
      record: DynamoDBRecord,
    ) => BaseEvent<unknown> | null | undefined;
  } & EventConsumerDeps,
  business: (
    payload: unknown,
    meta: Pick<EventMeta, 'correlationId' | 'retryCount' | 'publishedAt'>,
  ) => Promise<void>,
): (event: DynamoDBStreamevent: any, context: TContext) => Promise<TResult> {
  const { operation, mapRecordToBaseevent: any, ...consumerOpts } = options;
  const deps: EventConsumerDeps = consumerOpts;
  const consumer = new EventConsumer(deps);

  const inner = async (event: DynamoDBStreamEvent): Promise<TResult> => {
    const batchItemFailures: { itemIdentifier: string }[] = [];

    for (const record of event.Records ?? []) {
      const base = mapRecordToBaseEvent(record);
      if (base == null) {
        continue;
      }
      try {
        const result = await consumer.handle<unknown>(base, async (e) =>
          business(e.payload, {
            correlationId: e.meta.correlationId,
            retryCount: e.meta.retryCount,
            publishedAt: e.meta.publishedAt,
          }),
        );
        if (result.outcome === 'duplicate') {
          continue;
        }
        if (result.outcome === 'discarded_non_retryable') {
          continue;
        }
        if (result.outcome === 'dead_letter_candidate') {
          batchItemFailures.push({
            itemIdentifier: itemIdentifierFromStreamRecord(record),
          });
        }
      } catch {
        batchItemFailures.push({
          itemIdentifier: itemIdentifierFromStreamRecord(record),
        });
      }
    }

    return { batchItemFailures } as TResult;
  };

  const stack = buildEventExecutionPipeline<TResult, TContext>({
    operation,
  }) as unknown as Array<Middleware<DynamoDBStreamevent: any, TResult, TContext>>;

  return runMiddlewares(
    stack,
    inner as unknown as Handler<DynamoDBStreamevent: any, TResult, TContext>,
  );
}
