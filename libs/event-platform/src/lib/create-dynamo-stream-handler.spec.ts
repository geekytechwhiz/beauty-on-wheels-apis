/**
 * @jest-environment node
 */
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Context, DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';
import { z } from 'zod';

import { getContext } from '@api-hub/observability';

import { defineEvent } from '../core/schema/define-event';
import { createDynamoStreamHandler } from './create-dynamo-stream-handler';
import { onDynamoEvent } from './on-dynamo-event';

jest.mock('@api-hub/observability', () => {
  const actual = jest.requireActual('@api-hub/observability');
  return {
    ...actual,
    publishMiddlewarePipelineMetrics: jest.fn(),
  };
});

const PatientUpdatedSchema = defineEvent(
  z.object({ patientId: z.string(), status: z.string().optional() }),
  {
    eventType: 'Patient.Updated',
    eventVersion: '1.0.0',
    source: 'patients-svc',
    transport: 'sqs',
  },
);

function streamRecord(overrides: Partial<DynamoDBRecord> = {}): DynamoDBRecord {
  const { dynamodb: ddbOverride, ...rest } = overrides;

  const baseDdb = {
    Keys: { pk: { S: 'p-1' } } as Record<string, AttributeValue>,
    NewImage: {
      pk: { S: 'p-1' },
      patientId: { S: 'pat-99' },
      status: { S: 'active' },
    } as Record<string, AttributeValue>,
    SequenceNumber: '111',
    SizeBytes: 10,
    StreamViewType: 'NEW_AND_OLD_IMAGES' as const,
  };

  const mergedDdb = {
    ...baseDdb,
    ...(ddbOverride ?? {}),
  };

  return {
    eventID: `eid-${Math.random().toString(36).slice(2, 9)}`,
    eventName: 'INSERT',
    eventVersion: '1.1',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    eventSourceARN:
      'arn:aws:dynamodb:us-east-1:123456789012:table/patients-dev/stream/2024-01-01T00:00:00.000',
    dynamodb: mergedDdb,
    ...rest,
    dynamodb: mergedDdb,
  };
}

const lambdaContext = {
  awsRequestId: 'ddb-req-1',
  getRemainingTimeInMillis: () => 300_000,
} as unknown as Context;

describe('createDynamoStreamHandler', () => {
  it('processes INSERT and returns empty batchItemFailures', async () => {
    const handler = createDynamoStreamHandler({
      operation: 'patient.updated',
      consumer: {
        retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
        dlq: { enabled: false },
      },
      events: [
        {
          table: 'patients',
          eventName: ['INSERT'],
          schema: PatientUpdatedSchema,
          handler: async (evt) => {
            expect(evt.patientId).toBe('pat-99');
            const als = getContext() as Record<string, string | undefined>;
            expect(als.dynamodbEventName).toBe('INSERT');
            expect(String(als.dynamodbTableName ?? '')).toContain('patients');
          },
        },
      ],
    });

    const event: DynamoDBStreamEvent = {
      Records: [streamRecord()],
    };

    const out = await handler(event, lambdaContext);
    expect(out.batchItemFailures).toEqual([]);
  });

  it('acks filtered records without batch failures', async () => {
    const handler = createDynamoStreamHandler({
      operation: 'patient.updated',
      consumer: {
        retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
        dlq: { enabled: false },
      },
      events: [
        {
          table: 'patients',
          eventName: ['MODIFY'],
          schema: PatientUpdatedSchema,
          handler: async () => {
            throw new Error('should not run');
          },
        },
      ],
    });

    const event: DynamoDBStreamEvent = {
      Records: [streamRecord({ eventName: 'INSERT' })],
    };

    const out = await handler(event, lambdaContext);
    expect(out.batchItemFailures).toEqual([]);
  });
});

describe('onDynamoEvent', () => {
  it('wraps createDynamoStreamHandler with default event filters', async () => {
    const handler = onDynamoEvent(PatientUpdatedSchema, async (evt) => {
      expect(evt.patientId).toBe('pat-99');
    });

    const event: DynamoDBStreamEvent = {
      Records: [streamRecord()],
    };

    const out = await handler(event, lambdaContext);
    expect(out.batchItemFailures).toEqual([]);
  });
});
