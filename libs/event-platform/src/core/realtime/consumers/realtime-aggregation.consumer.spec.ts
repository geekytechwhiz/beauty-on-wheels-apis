/**
 * @jest-environment node
 */
import type { LambdaInvocationContext } from '@api-hub/observability';
import type { SQSRecord, SQSEvent } from 'aws-lambda';

import { REALTIME_AGGREGATE_EVENT_TYPE } from '../schemas/realtime-aggregate.event';
import type { RealtimePublisher } from '../interfaces/realtime-publisher.interface';
import type { RealtimeAggregateMessage } from '../types/realtime-aggregate-message.type';
import { RealtimeAggregationService } from '../services/realtime-aggregation.service';
import { createRealtimeAggregationConsumer } from './realtime-aggregation.consumer';

jest.mock('@api-hub/observability', () => {
  const actual = jest.requireActual('@api-hub/observability');
  return {
    ...actual,
    publishMiddlewarePipelineMetrics: jest.fn(),
  };
});

function aggregateBaseEvent(overrides: {
  eventId?: string;
  idempotencyKey?: string;
  payload?: Partial<RealtimeAggregateMessage>;
} = {}) {
  const payload: RealtimeAggregateMessage = {
    recipients: [{ userId: 'user-1', organizationId: 'ORG1' }],
    message: {
      channel: 'TEAM_ALERTS',
      eventType: 'TEAM_ALERTS_UPDATED',
      payload: { alertId: 'a1' },
      recipientIds: ['user-1'],
    },
    metadata: {
      correlationId: 'corr-1',
      eventId: 'evt-1',
      eventType: 'Alert.Created',
      eventVersion: '1.0.0',
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    ...overrides.payload,
  };

  return {
    eventId: overrides.eventId ?? 'evt-1',
    eventType: REALTIME_AGGREGATE_EVENT_TYPE,
    eventVersion: '1.0.0',
    timestamp: '2026-01-01T00:00:00.000Z',
    source: 'event-platform',
    idempotencyKey: overrides.idempotencyKey ?? 'idem-1',
    payload,
    meta: { correlationId: 'corr-1' },
  };
}

function sqsRecordFromBody(body: unknown, overrides: Partial<SQSRecord> = {}): SQSRecord {
  return {
    messageId: 'mid-1',
    receiptHandle: 'rh-1',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '1',
      SenderId: 'sender',
      ApproximateFirstReceiveTimestamp: '1',
    },
    messageAttributes: {},
    md5OfBody: 'x',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:q',
    awsRegion: 'us-east-1',
    ...overrides,
  };
}

const lambdaContext = {
  awsRequestId: 'req-test-1',
  getRemainingTimeInMillis: () => 300_000,
} satisfies LambdaInvocationContext;

describe('createRealtimeAggregationConsumer', () => {
  it('aggregates same-group batch into one publish', async () => {
    const published: unknown[] = [];
    const realtimePublisher: RealtimePublisher = {
      publish: async (messages) => {
        published.push(...messages);
      },
    };

    const handler = createRealtimeAggregationConsumer({
      realtimePublisher,
      consumer: {
        retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
        dlq: { enabled: false },
      },
    });

    const event: SQSEvent = {
      Records: [
        sqsRecordFromBody(aggregateBaseEvent(), { messageId: 'mid-1' }),
        sqsRecordFromBody(aggregateBaseEvent({ eventId: 'evt-2', idempotencyKey: 'idem-2' }), {
          messageId: 'mid-2',
        }),
        sqsRecordFromBody(aggregateBaseEvent({ eventId: 'evt-3', idempotencyKey: 'idem-3' }), {
          messageId: 'mid-3',
        }),
      ],
    };

    const result = await handler(event, lambdaContext);

    expect(result.batchItemFailures).toEqual([]);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      eventId: 'evt-1',
      eventVersion: '1.0.0',
      payload: { count: 3 },
      meta: { correlationId: 'corr-1' },
    });
  });

  it('returns partial batch failures when per-record handler fails', async () => {
    const published: unknown[] = [];
    const realtimePublisher: RealtimePublisher = {
      publish: async (messages) => {
        published.push(...messages);
      },
    };

    const handler = createRealtimeAggregationConsumer({
      realtimePublisher,
      consumer: {
        retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
        dlq: { enabled: false },
      },
    });

    const badBody = aggregateBaseEvent();
    badBody.eventType = 'unknown.event.type';

    const event: SQSEvent = {
      Records: [
        sqsRecordFromBody(aggregateBaseEvent(), { messageId: 'mid-1' }),
        sqsRecordFromBody(badBody, { messageId: 'mid-bad' }),
      ],
    };

    const result = await handler(event, lambdaContext);

    expect(result.batchItemFailures).toEqual(
      expect.arrayContaining([{ itemIdentifier: 'mid-bad' }]),
    );
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      payload: { count: 1 },
      meta: { correlationId: 'corr-1' },
    });
  });

  it('returns batch failures when groupAndPublish fails', async () => {
    const aggregationService = new RealtimeAggregationService({
      publish: async () => {
        throw new Error('flush failed');
      },
    });

    const handler = createRealtimeAggregationConsumer({
      realtimePublisher: { publish: jest.fn() },
      aggregationService,
      consumer: {
        retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
        dlq: { enabled: false },
      },
    });

    const event: SQSEvent = {
      Records: [sqsRecordFromBody(aggregateBaseEvent(), { messageId: 'mid-1' })],
    };

    const result = await handler(event, lambdaContext);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'mid-1' }]);
  });

  it('acks poison messages after retry exhaustion without batch failure', async () => {
    const published: unknown[] = [];
    const realtimePublisher: RealtimePublisher = {
      publish: async (messages) => {
        published.push(...messages);
      },
    };
    const handler = createRealtimeAggregationConsumer({
      realtimePublisher,
      consumer: {
        retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
        dlq: {
          enabled: true,
          strategy: { send: jest.fn().mockResolvedValue(undefined) },
        },
      },
    });

    const badBody = aggregateBaseEvent();
    badBody.eventType = 'unknown.event.type';

    const event: SQSEvent = {
      Records: [
        sqsRecordFromBody(badBody, {
          messageId: 'mid-poison',
          attributes: {
            ApproximateReceiveCount: '5',
            SentTimestamp: '1',
            SenderId: 'sender',
            ApproximateFirstReceiveTimestamp: '1',
          },
        }),
      ],
    };

    const result = await handler(event, lambdaContext);
    expect(result.batchItemFailures).toEqual([]);
    expect(published).toHaveLength(0);
  });
});
