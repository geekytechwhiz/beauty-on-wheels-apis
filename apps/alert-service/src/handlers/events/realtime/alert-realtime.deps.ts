import {
  createRealtimeAggregationPublisher,
  resolveSocketRealtimePublisher,
  resetSocketRealtimePublisherCache,
  type RealtimeAggregationPublisher,
  type RealtimePublisher,
} from '@api-hub/event-platform';
 
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
