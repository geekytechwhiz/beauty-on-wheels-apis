/**
 * Platform-owned Lambda handler for the realtime aggregation SQS queue.
 *
 * Deploy once per environment (not per domain service). Point serverless at:
 * `libs/event-platform/src/handlers/realtime-aggregation-sqs.handler.main`
 */
import { createDefaultRealtimeAggregationConsumer } from '../core/realtime/consumers/realtime-aggregation.consumer';

export const handler = createDefaultRealtimeAggregationConsumer();
export const main = handler;
