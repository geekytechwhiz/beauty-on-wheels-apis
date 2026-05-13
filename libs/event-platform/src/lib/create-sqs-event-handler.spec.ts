/**
 * @jest-environment node
 */
import type { Context, SQSRecord, SQSEvent } from 'aws-lambda';
import { z } from 'zod';

import { getContext } from '@api-hub/observability';

import { defineEvent } from '../core/schema/define-event';
import { createSqsEventHandler } from './create-sqs-event-handler';

jest.mock('@api-hub/observability', () => {
  const actual = jest.requireActual('@api-hub/observability');
  return {
    ...actual,
    publishMiddlewarePipelineMetrics: jest.fn(),
  };
});

function sampleBaseEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'evt-1',
    eventType: 'Alert.Created',
    eventVersion: '1.0.0',
    timestamp: '2026-01-01T00:00:00.000Z',
    source: 'alerts',
    idempotencyKey: 'idem-1',
    payload: { alertId: 'a1' },
    meta: { correlationId: 'corr-from-meta' },
    ...overrides,
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

const AlertCreatedSchema = defineEvent(z.object({ alertId: z.string() }), {
  eventType: 'Alert.Created',
  eventVersion: '1.0.0',
  source: 'alerts',
  transport: 'sqs',
});

const lambdaContext = {
  awsRequestId: 'req-test-1',
  getRemainingTimeInMillis: () => 300_000,
} as unknown as Context;

describe('createSqsEventHandler', () => {
  it('returns empty batchItemFailures when all messages succeed', async () => {
    const handler = createSqsEventHandler({
      operation: 'alert.created',
      consumer: {
        retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
        dlq: { enabled: false },
      },
      events: [
        {
          schema: AlertCreatedSchema,
          handler: async (evt) => {
            expect(evt.alertId).toBe('a1');
            const als = getContext() as Record<string, string | undefined>;
            expect(['mid-1', 'mid-2']).toContain(als.messageId);
            if (evt.meta.correlationId === 'corr-from-meta') {
              expect(als.messageId).toBe('mid-1');
            } else {
              expect(als.messageId).toBe('mid-2');
              expect(evt.meta.correlationId).toBe('corr-2');
            }
          },
        },
      ],
    });

    const event: SQSEvent = {
      Records: [
        sqsRecordFromBody(sampleBaseEvent()),
        sqsRecordFromBody(
          sampleBaseEvent({
            eventId: 'evt-2',
            idempotencyKey: 'idem-2',
            meta: { correlationId: 'corr-2' },
          }),
          { messageId: 'mid-2', receiptHandle: 'rh-2' },
        ),
      ],
    };

    const out = await handler(event, lambdaContext);
    expect(out.batchItemFailures).toEqual([]);
  });

  it('unwraps SNS->SQS subscription envelope and processes inner BaseEvent', async () => {
    const inner = sampleBaseEvent();
    const snsEnvelope = {
      Type: 'Notification',
      Message: JSON.stringify(inner),
      TopicArn: 'arn:aws:sns:us-east-1:123:t',
    };
    const handler = createSqsEventHandler({
      operation: 'alert.created',
      consumer: {
        retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
        dlq: { enabled: false },
      },
      events: [
        {
          schema: AlertCreatedSchema,
          handler: async (evt) => {
            expect(evt.alertId).toBe('a1');
          },
        },
      ],
    });

    const event: SQSEvent = {
      Records: [sqsRecordFromBody(snsEnvelope)],
    };

    const out = await handler(event, lambdaContext);
    expect(out.batchItemFailures).toEqual([]);
  });

  it('reports batchItemFailures for a message that surfaces transport retry', async () => {
    const handler = createSqsEventHandler({
      operation: 'alert.created',
      consumer: {
        retry: { maxAttempts: 3, strategy: 'fixed', delayMs: 1 },
        dlq: { enabled: false },
      },
      events: [
        {
          schema: AlertCreatedSchema,
          handler: async () => {
            throw new Error('transient-boom');
          },
        },
      ],
    });

    const event: SQSEvent = {
      Records: [sqsRecordFromBody(sampleBaseEvent(), { messageId: 'fail-id' })],
    };

    const out = await handler(event, lambdaContext);
    expect(out.batchItemFailures).toEqual([{ itemIdentifier: 'fail-id' }]);
  });

  it('exposes FIFO metadata on per-message ALS context when attributes present', async () => {
    const handler = createSqsEventHandler({
      operation: 'alert.created',
      consumer: {
        retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
        dlq: { enabled: false },
      },
      events: [
        {
          schema: AlertCreatedSchema,
          handler: async () => {
            const als = getContext() as Record<string, unknown>;
            expect(als.fifoMessageGroupId).toBe('g1');
            expect(als.fifoMessageDeduplicationId).toBe('d1');
          },
        },
      ],
    });

    const rec = sqsRecordFromBody(sampleBaseEvent(), {
      messageId: 'fifo-1',
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1',
        SenderId: 'sender',
        ApproximateFirstReceiveTimestamp: '1',
        MessageGroupId: 'g1',
        MessageDeduplicationId: 'd1',
        SequenceNumber: '18850992266606460416',
      },
    });

    const out = await handler({ Records: [rec] }, lambdaContext);
    expect(out.batchItemFailures).toEqual([]);
  });
});
