import { SqsAdapter } from '../../../adapters/sqs/sqs-adapter';
import { EventPublisher } from '../../../sdk/publisher/event-publisher';
import {
  REALTIME_AGGREGATE_EVENT_TYPE,
  RealtimeAggregateEventSchema,
  RealtimeAggregatePayloadSchema,
} from '../schemas/realtime-aggregate.event';
import type { RealtimeAggregateMessage } from '../types/realtime-aggregate-message.type';

export type RealtimeAggregationPublisherOptions = {
  queueUrl?: string;
  region?: string;
  source?: string;
};

export class RealtimeAggregationPublisher {
  constructor(
    private readonly eventPublisher: EventPublisher,
    private readonly source = 'event-platform',
  ) {}

  async publish(data: RealtimeAggregateMessage): Promise<void> {
    await this.eventPublisher.publish({
      eventType: REALTIME_AGGREGATE_EVENT_TYPE,
      version: RealtimeAggregateEventSchema.__meta.eventVersion,
      source: this.source,
      payload: data,
      meta: {
        correlationId: data.metadata.correlationId,
      },
    });
  }
}

export function createRealtimeAggregationPublisher(
  options: RealtimeAggregationPublisherOptions = {},
): RealtimeAggregationPublisher | undefined {
  const queueUrl =
    (typeof options.queueUrl === 'string' && options.queueUrl.trim()) ||
    (typeof process.env.REALTIME_AGGREGATION_QUEUE_URL === 'string' &&
      process.env.REALTIME_AGGREGATION_QUEUE_URL.trim()) ||
    '';

  if (!queueUrl) {
    return undefined;
  }

  const region =
    options.region ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    'us-east-1';

  const adapter = new SqsAdapter({ queueUrl, region });
  const eventPublisher = new EventPublisher({
    adapter,
    payloadSchemas: {
      [REALTIME_AGGREGATE_EVENT_TYPE]: RealtimeAggregatePayloadSchema,
    },
    serviceName: 'realtime-aggregation-publisher',
  });

  return new RealtimeAggregationPublisher(
    eventPublisher,
    options.source ?? 'event-platform',
  );
}
