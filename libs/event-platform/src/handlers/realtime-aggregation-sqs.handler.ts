import type { LambdaInvocationContext } from '@api-hub/observability';
import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';

import { createDefaultRealtimeAggregationConsumer } from '../core/realtime/consumers/realtime-aggregation.consumer';

type RealtimeAggregationHandler = (
  event: SQSEvent,
  context: LambdaInvocationContext,
) => Promise<SQSBatchResponse>;

let realTimehandler: RealtimeAggregationHandler | undefined;

function getHandler(): RealtimeAggregationHandler {
  realTimehandler ??= createDefaultRealtimeAggregationConsumer();
  return handler;
}

export const main: RealtimeAggregationHandler = (event, context) =>
  getHandler()(event, context);

export const handler = main;
