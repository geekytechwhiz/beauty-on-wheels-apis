import { getContext } from '@api-hub/observability';
import type { LambdaInvocationContext } from '@api-hub/observability';
import type { IdempotencyStrategy } from '@api-hub/event-platform';

import { createVendorOnboardingSubmittedConsumer } from '../handlers/vendor-onboarding-submitted.js';
import type { EmailNotificationProcessor } from '../services/EmailNotificationProcessor.js';
import { eventBridgeOnSqs } from './sqs-fixture.js';

jest.mock('../../../common/config/environment.js', () => ({
  environment: {
    allowedOrigin: '*',
    awsRegion: 'us-east-1',
    recipientsBucket: '',
    emailBatchBucket: '',
    attachmentsBucket: '',
    emailQueueUrl: '',
    registryTable: 'RecipientTablesRegistry',
    campaignsTable: 'Campaigns',
    campaignBatchesTable: 'CampaignBatches',
    recipientTrackingTable: 'RecipientTracking',
    recipientsTable: 'Recipients',
    contactListName: null,
    topicName: '',
    emailRateLimit: 50,
    batchSize: 1000,
    defaultFromEmail: 'noreply@beautyonwheels.test',
    defaultFromName: 'Beauty on Wheels',
    vendorOnboardingTemplateName: 'VendorOnboardingSubmitted',
    vendorEmailConfirmationTemplateName: 'vendor_email_confirmation',
    bookingConfirmedTemplateName: 'BookingConfirmed',
    emailNotificationQueueUrl: '',
    emailNotificationDlqUrl: '',
    emailDeliveryTable: 'email-delivery',
    sesConfigurationSet: 'email-delivery',
    sesReplyTo: '',
    sesUnsubscribeUrl: '',
    emailDeliveryLockMs: 150000,
    isOffline: true,
  },
}));

jest.mock('@api-hub/observability', () => {
  const actual = jest.requireActual('@api-hub/observability');
  return {
    ...actual,
    publishMiddlewarePipelineMetrics: jest.fn(),
  };
});

const lambdaContext: LambdaInvocationContext = {
  awsRequestId: 'email-req-1',
  getRemainingTimeInMillis: () => 300_000,
};

const submittedDetail = {
  eventId: 'evt-submit-1',
  eventType: 'VendorOnboarding.Submitted',
  eventVersion: '1.0.0',
  timestamp: '2026-01-01T00:00:00.000Z',
  source: 'vendor-service',
  idempotencyKey: 'VendorOnboarding.Submitted:app-1',
  payload: {
    applicationId: 'app-1',
    vendorId: 'vendor-1',
    ownerUserId: 'user-1',
    email: 'owner@example.com',
    onboardingStatus: 'PENDING_REVIEW' as const,
    businessName: 'ABC Car Wash',
  },
  meta: { correlationId: 'corr-submit-1' },
};

function consumerWithProcessor(
  processor: EmailNotificationProcessor,
  extra?: { idempotencyStrategy?: IdempotencyStrategy },
) {
  return createVendorOnboardingSubmittedConsumer({
    processor,
    consumer: {
      retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
      dlq: { enabled: false },
      ...(extra?.idempotencyStrategy ? { idempotencyStrategy: extra.idempotencyStrategy } : {}),
    },
  });
}

describe('vendor onboarding submitted email consumer', () => {
  let processor: { deliver: jest.Mock };

  beforeEach(() => {
    processor = {
      deliver: jest.fn().mockResolvedValue({ messageId: 'ses-1', duplicate: false }),
    };
  });

  it('resolves the vendor onboarding template and sends the email', async () => {
    const handler = consumerWithProcessor(processor as unknown as EmailNotificationProcessor);
    await handler(
      eventBridgeOnSqs({
        source: 'vendor-service',
        detailType: 'VendorOnboarding.Submitted',
        detail: submittedDetail,
      }),
      lambdaContext,
    );

    expect(processor.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'VendorOnboardingSubmitted',
        recipient: { email: 'owner@example.com' },
        parameters: {
          applicationId: 'app-1',
          vendorId: 'vendor-1',
          businessName: 'ABC Car Wash',
        },
      }),
    );
  });

  it('does not send again for a duplicate event', async () => {
    const duplicateStrategy: IdempotencyStrategy = {
      before: async () => 'DUPLICATE',
      afterSuccess: async () => undefined,
      onError: async () => undefined,
    };
    const handler = consumerWithProcessor(processor as unknown as EmailNotificationProcessor, {
      idempotencyStrategy: duplicateStrategy,
    });
    await handler(
      eventBridgeOnSqs({
        source: 'vendor-service',
        detailType: 'VendorOnboarding.Submitted',
        detail: submittedDetail,
      }),
      lambdaContext,
    );
    expect(processor.deliver).not.toHaveBeenCalled();
  });

  it('follows Event Platform validation when the event is invalid', async () => {
    const handler = consumerWithProcessor(processor as unknown as EmailNotificationProcessor);
    await handler(
      eventBridgeOnSqs({
        source: 'vendor-service',
        detailType: 'VendorOnboarding.Submitted',
        detail: {
          ...submittedDetail,
          eventId: 'evt-invalid',
          payload: {
            applicationId: 'app-1',
            vendorId: 'vendor-1',
            ownerUserId: 'user-1',
            email: 'not-an-email',
            onboardingStatus: 'PENDING_REVIEW',
          },
        },
      }),
      lambdaContext,
    );
    expect(processor.deliver).not.toHaveBeenCalled();
  });

  it('returns the SQS message for retry when delivery fails', async () => {
    processor.deliver.mockRejectedValue(new Error('SES unavailable'));
    const handler = consumerWithProcessor(processor as unknown as EmailNotificationProcessor);
    const result = await handler(
      eventBridgeOnSqs({
        source: 'vendor-service',
        detailType: 'VendorOnboarding.Submitted',
        detail: submittedDetail,
      }),
      lambdaContext,
    );
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'mid-1' }]);
  });

  it('preserves the correlation ID in Event Platform context', async () => {
    processor.deliver.mockImplementation(async () => {
      expect(getContext().correlationId).toBe('corr-submit-1');
      return { messageId: 'ses-1', duplicate: false };
    });
    const handler = consumerWithProcessor(processor as unknown as EmailNotificationProcessor);
    await handler(
      eventBridgeOnSqs({
        source: 'vendor-service',
        detailType: 'VendorOnboarding.Submitted',
        detail: submittedDetail,
      }),
      lambdaContext,
    );
    expect(processor.deliver).toHaveBeenCalledTimes(1);
  });
});
