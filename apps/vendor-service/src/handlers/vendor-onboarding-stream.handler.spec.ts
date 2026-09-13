import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';
import type { LambdaInvocationContext } from '@api-hub/observability';
import {
  vendorOnboardingSubmittedIdempotencyKey,
  type VendorOnboardingSubmittedPayload,
} from '@api-hub/event-platform';

import { createVendorOnboardingSubmittedStreamHandler } from './vendor-onboarding-stream.handler';

jest.mock('@api-hub/observability', () => {
  const actual = jest.requireActual('@api-hub/observability');
  return {
    ...actual,
    publishMiddlewarePipelineMetrics: jest.fn(),
  };
});

const lambdaContext = {
  awsRequestId: 'stream-req-1',
  getRemainingTimeInMillis: () => 300_000,
} satisfies LambdaInvocationContext;

function attrString(value: string): AttributeValue {
  return { S: value };
}

function vendorImage(
  overrides: Record<string, AttributeValue> = {},
): Record<string, AttributeValue> {
  return {
    PK: attrString('VENDOR#vendor-1'),
    SK: attrString('PROFILE'),
    vendorId: attrString('vendor-1'),
    ownerUserId: attrString('user-1'),
    email: attrString('owner@example.com'),
    businessName: attrString('ABC Car Wash'),
    applicationId: attrString('app-1'),
    onboardingStatus: attrString('PENDING_REVIEW'),
    entityType: attrString('Vendor'),
    meta: {
      M: {
        correlationId: attrString('corr-submit-1'),
      },
    },
    ...overrides,
  };
}

function streamRecord(overrides: {
  eventID?: string;
  eventName?: DynamoDBRecord['eventName'];
  oldImage?: Record<string, AttributeValue>;
  newImage?: Record<string, AttributeValue>;
} = {}): DynamoDBRecord {
  return {
    eventID: overrides.eventID ?? `eid-${Math.random().toString(36).slice(2, 9)}`,
    eventName: overrides.eventName ?? 'MODIFY',
    eventVersion: '1.1',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    eventSourceARN:
      'arn:aws:dynamodb:us-east-1:123456789012:table/vendor-service-api-dev-vendor/stream/2026-01-01T00:00:00.000',
    dynamodb: {
      Keys: { PK: attrString('VENDOR#vendor-1'), SK: attrString('PROFILE') },
      OldImage: overrides.oldImage,
      NewImage: overrides.newImage ?? vendorImage(),
      SequenceNumber: '111',
      SizeBytes: 10,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
  };
}

function handlerWithPublish(publish: jest.Mock) {
  return createVendorOnboardingSubmittedStreamHandler({
    publish: publish as (
      payload: VendorOnboardingSubmittedPayload,
      correlationId: string,
    ) => Promise<void>,
    consumer: {
      retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
      dlq: { enabled: false },
    },
  });
}

describe('vendor onboarding submitted stream handler', () => {
  it('publishes VendorOnboarding.Submitted on IN_PROGRESS → PENDING_REVIEW', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const handler = handlerWithPublish(publish);

    const event: DynamoDBStreamEvent = {
      Records: [
        streamRecord({
          oldImage: vendorImage({ onboardingStatus: attrString('IN_PROGRESS') }),
          newImage: vendorImage(),
        }),
      ],
    };

    const out = await handler(event, lambdaContext);

    expect(out.batchItemFailures).toEqual([]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: 'app-1',
        vendorId: 'vendor-1',
        ownerUserId: 'user-1',
        email: 'owner@example.com',
        onboardingStatus: 'PENDING_REVIEW',
        businessName: 'ABC Car Wash',
      }),
      'corr-submit-1',
    );
  });

  it('does not publish DRAFT → IN_PROGRESS', async () => {
    const publish = jest.fn();
    const handler = handlerWithPublish(publish);

    const event: DynamoDBStreamEvent = {
      Records: [
        streamRecord({
          oldImage: vendorImage({
            onboardingStatus: attrString('DRAFT'),
            applicationId: attrString(''),
          }),
          newImage: vendorImage({
            onboardingStatus: attrString('IN_PROGRESS'),
            applicationId: attrString(''),
          }),
        }),
      ],
    };

    const out = await handler(event, lambdaContext);

    expect(out.batchItemFailures).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not publish PENDING_REVIEW → PENDING_REVIEW', async () => {
    const publish = jest.fn();
    const handler = handlerWithPublish(publish);

    const event: DynamoDBStreamEvent = {
      Records: [
        streamRecord({
          oldImage: vendorImage(),
          newImage: vendorImage({ businessName: attrString('Renamed') }),
        }),
      ],
    };

    const out = await handler(event, lambdaContext);

    expect(out.batchItemFailures).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not publish unrelated child-item updates', async () => {
    const publish = jest.fn();
    const handler = handlerWithPublish(publish);

    const event: DynamoDBStreamEvent = {
      Records: [
        streamRecord({
          oldImage: {
            PK: attrString('VENDOR#vendor-1'),
            SK: attrString('DOCUMENT#doc-1'),
            entityType: attrString('VendorDocument'),
          },
          newImage: {
            PK: attrString('VENDOR#vendor-1'),
            SK: attrString('DOCUMENT#doc-1'),
            entityType: attrString('VendorDocument'),
            fileName: attrString('gst.pdf'),
          },
        }),
      ],
    };

    const out = await handler(event, lambdaContext);

    expect(out.batchItemFailures).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it('reports a batch failure when required application data is missing', async () => {
    const publish = jest.fn();
    const handler = handlerWithPublish(publish);

    const event: DynamoDBStreamEvent = {
      Records: [
        streamRecord({
          eventID: 'eid-missing',
          oldImage: vendorImage({ onboardingStatus: attrString('IN_PROGRESS') }),
          newImage: vendorImage({
            email: attrString(''),
            applicationId: attrString(''),
          }),
        }),
      ],
    };

    const out = await handler(event, lambdaContext);

    expect(out.batchItemFailures).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes only the submitted record in a mixed batch', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const handler = handlerWithPublish(publish);

    const event: DynamoDBStreamEvent = {
      Records: [
        streamRecord({
          eventID: 'eid-progress',
          oldImage: vendorImage({ onboardingStatus: attrString('DRAFT') }),
          newImage: vendorImage({ onboardingStatus: attrString('IN_PROGRESS') }),
        }),
        streamRecord({
          eventID: 'eid-submit',
          oldImage: vendorImage({ onboardingStatus: attrString('IN_PROGRESS') }),
          newImage: vendorImage(),
        }),
        streamRecord({
          eventID: 'eid-already',
          oldImage: vendorImage(),
          newImage: vendorImage({ businessName: attrString('Still Submitted') }),
        }),
      ],
    };

    const out = await handler(event, lambdaContext);

    expect(out.batchItemFailures).toEqual([]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].applicationId).toBe('app-1');
  });

  it('handles a replayed stream record without throwing', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const handler = handlerWithPublish(publish);
    const record = streamRecord({
      eventID: 'eid-replay',
      oldImage: vendorImage({ onboardingStatus: attrString('IN_PROGRESS') }),
      newImage: vendorImage(),
    });
    const event: DynamoDBStreamEvent = { Records: [record] };

    const first = await handler(event, lambdaContext);
    const second = await handler(event, lambdaContext);

    expect(first.batchItemFailures).toEqual([]);
    expect(second.batchItemFailures).toEqual([]);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(vendorOnboardingSubmittedIdempotencyKey('app-1')).toBe(
      'VendorOnboarding.Submitted:app-1',
    );
  });
});
