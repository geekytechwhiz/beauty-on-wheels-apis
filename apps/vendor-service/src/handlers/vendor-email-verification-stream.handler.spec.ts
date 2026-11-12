import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';
import type { LambdaInvocationContext } from '@api-hub/observability';

import { createVendorProfileStreamHandler } from './vendor-email-verification-stream';

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
    createdBy: attrString('staff-1'),
    loginPhoneNumber: attrString('+919876543210'),
    accountProvisioningStatus: attrString('PENDING'),
    email: attrString('owner@example.com'),
    contactName: attrString('Priya Sharma'),
    businessName: attrString('ABC Car Wash'),
    applicationId: attrString('app-1'),
    status: attrString('PENDING_VERIFICATION'),
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

function handlerWithDeps(deps: {
  publishProvisioning?: jest.Mock;
  publishEmail?: jest.Mock;
}) {
  return createVendorProfileStreamHandler({
    publishProvisioning: deps.publishProvisioning as never,
    publishEmail: deps.publishEmail as never,
    markEmailDispatched: async () => undefined,
    consumer: {
      retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
      dlq: { enabled: false },
    },
  });
}

describe('vendor profile stream handler', () => {
  it('on INSERT requests account provisioning and email verification', async () => {
    const publishProvisioning = jest.fn().mockResolvedValue(undefined);
    const publishEmail = jest.fn().mockResolvedValue(undefined);
    const handler = handlerWithDeps({ publishProvisioning, publishEmail });

    const out = await handler(
      { Records: [streamRecord({ eventName: 'INSERT', newImage: vendorImage() })] },
      lambdaContext,
    );

    expect(out.batchItemFailures).toEqual([]);
    expect(publishProvisioning).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: 'vendor-1',
        loginPhoneNumber: '+919876543210',
        displayName: 'Priya Sharma',
        email: 'owner@example.com',
      }),
      'corr-confirm-1',
    );
    expect(publishEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: 'vendor-1',
        verificationRequestId: 'verify-1',
        intent: 'VENDOR_EMAIL_VERIFICATION',
        verificationToken: '482193',
      }),
      'corr-confirm-1',
    );
  });

  it('does not derive the login account from createdBy / staff creator', async () => {
    const publishProvisioning = jest.fn().mockResolvedValue(undefined);
    const handler = handlerWithDeps({ publishProvisioning, publishEmail: jest.fn() });

    await handler(
      {
        Records: [
          streamRecord({
            eventName: 'INSERT',
            newImage: vendorImage({
              createdBy: attrString('staff-admin-99'),
              emailVerificationDispatchPending: { BOOL: false },
              emailVerificationRequestId: attrString(''),
              emailVerificationOtp: attrString(''),
            }),
          }),
        ],
      },
      lambdaContext,
    );

    expect(publishProvisioning).toHaveBeenCalledWith(
      expect.objectContaining({ loginPhoneNumber: '+919876543210' }),
      expect.any(String),
    );
    expect(publishProvisioning.mock.calls[0][0].loginPhoneNumber).not.toContain(
      'staff',
    );
  });

  it('publishes email verification for a MODIFY request transition', async () => {
    const publishEmail = jest.fn().mockResolvedValue(undefined);
    const publishProvisioning = jest.fn();
    const handler = handlerWithDeps({ publishProvisioning, publishEmail });

    const out = await handler(
      {
        Records: [
          streamRecord({
            eventName: 'MODIFY',
            oldImage: vendorImage({
              emailVerificationRequestId: attrString('old'),
              accountProvisioningStatus: attrString('COMPLETED'),
              identityId: attrString('sub-1'),
              emailVerificationDispatchPending: { BOOL: false },
            }),
            newImage: vendorImage({
              accountProvisioningStatus: attrString('COMPLETED'),
              identityId: attrString('sub-1'),
              ownerUserId: attrString('user-1'),
            }),
          }),
        ],
      },
      lambdaContext,
    );

    expect(out.batchItemFailures).toEqual([]);
    expect(publishProvisioning).not.toHaveBeenCalled();
    expect(publishEmail).toHaveBeenCalledTimes(1);
  });

  it('does not restart provisioning on linkage/status MODIFY', async () => {
    const publishProvisioning = jest.fn();
    const publishEmail = jest.fn();
    const handler = handlerWithDeps({ publishProvisioning, publishEmail });

    const out = await handler(
      {
        Records: [
          streamRecord({
            eventName: 'MODIFY',
            oldImage: vendorImage({
              accountProvisioningStatus: attrString('PENDING'),
              emailVerificationDispatchPending: { BOOL: false },
              emailVerificationRequestId: attrString('verify-1'),
            }),
            newImage: vendorImage({
              accountProvisioningStatus: attrString('COMPLETED'),
              identityId: attrString('sub-1'),
              ownerUserId: attrString('user-1'),
              emailVerificationDispatchPending: { BOOL: false },
              emailVerificationRequestId: attrString('verify-1'),
              emailVerificationOtp: attrString('482193'),
            }),
          }),
        ],
      },
      lambdaContext,
    );

    expect(out.batchItemFailures).toEqual([]);
    expect(publishProvisioning).not.toHaveBeenCalled();
    expect(publishEmail).not.toHaveBeenCalled();
  });

  it('ignores unrelated child-item updates', async () => {
    const publishProvisioning = jest.fn();
    const publishEmail = jest.fn();
    const handler = handlerWithDeps({ publishProvisioning, publishEmail });

    const out = await handler(
      {
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
              status: attrString('UPLOADED'),
            },
          }),
        ],
      },
      lambdaContext,
    );

    expect(out.batchItemFailures).toEqual([]);
    expect(publishProvisioning).not.toHaveBeenCalled();
    expect(publishEmail).not.toHaveBeenCalled();
  });

  it('reports partial batch failures when provisioning publish fails', async () => {
    const publishProvisioning = jest
      .fn()
      .mockRejectedValue(new Error('eventbridge unavailable'));
    const publishEmail = jest.fn();
    const handler = handlerWithDeps({ publishProvisioning, publishEmail });

    const failingId = 'eid-fail-1';
    const out = await handler(
      {
        Records: [
          streamRecord({
            eventID: failingId,
            eventName: 'INSERT',
            newImage: vendorImage({
              emailVerificationDispatchPending: { BOOL: false },
              emailVerificationRequestId: attrString(''),
              emailVerificationOtp: attrString(''),
            }),
          }),
        ],
      },
      lambdaContext,
    );

    expect(out.batchItemFailures).toEqual([{ itemIdentifier: failingId }]);
    expect(publishEmail).not.toHaveBeenCalled();
  });

  it('does not recreate accounts when only email publish fails after provisioning accepted', async () => {
    const publishProvisioning = jest.fn().mockResolvedValue(undefined);
    const publishEmail = jest
      .fn()
      .mockRejectedValue(new Error('email bus unavailable'));
    const handler = handlerWithDeps({ publishProvisioning, publishEmail });

    const out = await handler(
      {
        Records: [
          streamRecord({
            eventID: 'eid-email-fail',
            eventName: 'INSERT',
            newImage: vendorImage(),
          }),
        ],
      },
      lambdaContext,
    );

    expect(publishProvisioning).toHaveBeenCalledTimes(1);
    expect(publishEmail).toHaveBeenCalledTimes(1);
    expect(out.batchItemFailures).toEqual([
      { itemIdentifier: 'eid-email-fail' },
    ]);
  });

  it('is safe for duplicate INSERT deliveries', async () => {
    const publishProvisioning = jest.fn().mockResolvedValue(undefined);
    const publishEmail = jest.fn().mockResolvedValue(undefined);
    const handler = handlerWithDeps({ publishProvisioning, publishEmail });

    const record = streamRecord({
      eventID: 'eid-dup',
      eventName: 'INSERT',
      newImage: vendorImage(),
    });
    const event: DynamoDBStreamEvent = { Records: [record, record] };

    const out = await handler(event, lambdaContext);
    expect(out.batchItemFailures).toEqual([]);
    expect(publishProvisioning).toHaveBeenCalled();
    expect(publishEmail).toHaveBeenCalled();
  });
});
