import {
  createRealtimeAggregationPublisher,
  type RealtimeAggregationPublisher,
} from '@api-hub/event-platform';

let cachedAggregationPublisher: RealtimeAggregationPublisher | undefined | null = null;

/** SQS aggregation queue producer; socket publish runs in realtimeAggregation Lambda. */
export function getAlertRealtimeAggregationPublisher(): RealtimeAggregationPublisher | undefined {
  if (cachedAggregationPublisher !== null) {
    return cachedAggregationPublisher;
  }

  cachedAggregationPublisher = createRealtimeAggregationPublisher({
    queueUrl: process.env.REALTIME_AGGREGATION_QUEUE_URL,
    source: 'alert-service',
  });

  return cachedAggregationPublisher;
}

export function resetAlertRealtimePublisherCache(): void {
  cachedAggregationPublisher = null;
}
