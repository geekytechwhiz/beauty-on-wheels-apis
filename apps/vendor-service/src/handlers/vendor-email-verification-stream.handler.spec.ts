import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';
import type { LambdaInvocationContext } from '@api-hub/observability';
import {
  vendorEmailVerificationRequestedIdempotencyKey,
  type VendorEmailVerificationRequestedPayload,
} from '@api-hub/event-platform';

import { createVendorEmailVerificationRequestedStreamHandler } from './vendor-email-verification-stream';

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

function attrNumber(value: number): AttributeValue {
  return { N: String(value) };
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
    contactName: attrString('Priya Sharma'),
    businessName: attrString('ABC Car Wash'),
    applicationId: attrString('app-1'),
    status: attrString('PENDING_VERIFICATION'),
    completedSections: {
      L: [
        attrString('BUSINESS_INFO'), attrString('OWNER_DETAILS'),
        attrString('ADDRESS'), attrString('BRANCH'), attrString('BANK_DETAILS'),
      ],
    },
    emailVerificationRequestId: attrString('verify-1'),
    emailVerificationOtp: attrString('482193'),
    emailVerificationDispatchPending: { BOOL: true },
    emailVerificationExpiryMinutes: attrNumber(10),
    emailVerificationRequestedAt: attrString('2026-01-01T00:00:00.000Z'),
    entityType: attrString('Vendor'),
    meta: {
      M: {
        correlationId: attrString('corr-confirm-1'),
      },
    },
    ...overrides,
  };
}

function incompleteVendorImage(): Record<string, AttributeValue> {
  return vendorImage({
    completedSections: {
      L: [
        attrString('BUSINESS_INFO'), attrString('OWNER_DETAILS'),
        attrString('ADDRESS'), attrString('BRANCH'),
      ],
    },
  });
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
  return createVendorEmailVerificationRequestedStreamHandler({
    publish: publish as (
      payload: VendorEmailVerificationRequestedPayload,
      correlationId: string,
    ) => Promise<void>,
    consumer: {
      retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
      dlq: { enabled: false },
    },
  });
}

describe('vendor email verification requested stream handler', () => {
  it('publishes VendorEmailVerification.Requested for a persisted request', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const handler = handlerWithPublish(publish);

    const event: DynamoDBStreamEvent = {
      Records: [
        streamRecord({
          oldImage: incompleteVendorImage(),
          newImage: vendorImage(),
        }),
      ],
    };

    const out = await handler(event, lambdaContext);

    expect(out.batchItemFailures).toEqual([]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: 'vendor-1',
        verificationRequestId: 'verify-1',
        intent: 'VENDOR_EMAIL_VERIFICATION',
        ownerUserId: 'user-1',
        email: 'owner@example.com',
        ownerName: 'Priya',
        businessName: 'ABC Car Wash',
        verificationToken: '482193',
        expiryMinutes: 10,
        vendorStatus: 'PENDING_VERIFICATION',
        applicationId: 'app-1',
      }),
      'corr-confirm-1',
    );
  });

  it('does not publish ACTIVE → ACTIVE', async () => {
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

  it('does not publish when verification data is missing', async () => {
    const publish = jest.fn();
    const handler = handlerWithPublish(publish);

    const event: DynamoDBStreamEvent = {
      Records: [
        streamRecord({
          eventID: 'eid-missing',
          oldImage: incompleteVendorImage(),
          newImage: vendorImage({
            email: attrString(''),
            emailVerificationOtp: attrString(''),
            contactName: attrString(''),
          }),
        }),
      ],
    };

    const out = await handler(event, lambdaContext);

    expect(out.batchItemFailures).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes only the confirmed record in a mixed batch', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const handler = handlerWithPublish(publish);

    const event: DynamoDBStreamEvent = {
      Records: [
        streamRecord({
          eventID: 'eid-progress',
          oldImage: incompleteVendorImage(),
          newImage: incompleteVendorImage(),
        }),
        streamRecord({
          eventID: 'eid-confirm',
          oldImage: incompleteVendorImage(),
          newImage: vendorImage(),
        }),
        streamRecord({
          eventID: 'eid-already',
          oldImage: vendorImage(),
          newImage: vendorImage({ businessName: attrString('Still Active') }),
        }),
      ],
    };

    const out = await handler(event, lambdaContext);

    expect(out.batchItemFailures).toEqual([]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].vendorId).toBe('vendor-1');
  });

  it('handles a replayed stream record without throwing', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const handler = handlerWithPublish(publish);
    const record = streamRecord({
      eventID: 'eid-replay',
      oldImage: incompleteVendorImage(),
      newImage: vendorImage(),
    });
    const event: DynamoDBStreamEvent = { Records: [record] };

    const first = await handler(event, lambdaContext);
    const second = await handler(event, lambdaContext);

    expect(first.batchItemFailures).toEqual([]);
    expect(second.batchItemFailures).toEqual([]);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(
      vendorEmailVerificationRequestedIdempotencyKey(
        'vendor-1',
        'verify-1',
      ),
    ).toBe('VendorEmailVerification.Requested:vendor-1:verify-1');
  });
});
