import type { LambdaInvocationContext } from '@api-hub/observability';
import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { createDefaultRealtimeAggregationConsumer } from '@api-hub/event-platform';

type RealtimeAggregationHandler = (
  event: SQSEvent,
  context: LambdaInvocationContext,
) => Promise<SQSBatchResponse>;

let handler: RealtimeAggregationHandler | undefined;

export const main: RealtimeAggregationHandler = (event, context) => {
  handler ??= createDefaultRealtimeAggregationConsumer();
  return handler(event, context);
};
