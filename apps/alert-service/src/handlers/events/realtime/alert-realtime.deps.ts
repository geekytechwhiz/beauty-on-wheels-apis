import {
  createRealtimeAggregationPublisher,
  resolveSocketRealtimePublisher,
  resetSocketRealtimePublisherCache,
  type RealtimeAggregationPublisher,
  type RealtimePublisher,
} from '@api-hub/event-platform';

/** Aggregate-only consumers enqueue to SQS; socket publish runs in realtimeAggregation. */
export const alertRealtimeNoopPublisher: RealtimePublisher = {
  publish: async () => {},
};

let cachedAggregationPublisher: RealtimeAggregationPublisher | undefined | null = null;
 
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
 
export function getAlertRealtimePublisher(): RealtimePublisher {
  return resolveSocketRealtimePublisher();
}

export function resetAlertRealtimePublisherCache(): void {
  cachedAggregationPublisher = null;
  resetSocketRealtimePublisherCache();
}
