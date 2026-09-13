import { getContext } from '@api-hub/observability';
import type { LambdaInvocationContext } from '@api-hub/observability';
import { BaseError } from '@api-hub/utils';
import type { IdempotencyStrategy } from '@api-hub/event-platform';

import { EmailService } from '../services/EmailService.js';
import { createVendorOnboardingSubmittedConsumer } from '../handlers/vendor-onboarding-submitted.js';

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

const eventBridgeEvent = {
  source: 'vendor-service',
  'detail-type': 'VendorOnboarding.Submitted',
  detail: submittedDetail,
};

function consumerWithEmailService(emailService: EmailService, extra?: {
  idempotencyStrategy?: IdempotencyStrategy;
}) {
  return createVendorOnboardingSubmittedConsumer({
    emailService,
    consumer: {
      retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
      dlq: { enabled: false },
      ...(extra?.idempotencyStrategy
        ? { idempotencyStrategy: extra.idempotencyStrategy }
        : {}),
    },
  });
}

describe('vendor onboarding submitted email consumer', () => {
  let emailService: { sendVendorOnboardingSubmittedEmail: jest.Mock };

  beforeEach(() => {
    emailService = {
      sendVendorOnboardingSubmittedEmail: jest.fn().mockResolvedValue({
        messageId: 'ses-1',
      }),
    };
  });

  it('resolves the vendor onboarding template and sends the email', async () => {
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
    );

    await handler(eventBridgeEvent, lambdaContext);

    expect(emailService.sendVendorOnboardingSubmittedEmail).toHaveBeenCalledWith({
      applicationId: 'app-1',
      vendorId: 'vendor-1',
      ownerUserId: 'user-1',
      email: 'owner@example.com',
      onboardingStatus: 'PENDING_REVIEW',
      businessName: 'ABC Car Wash',
    });
  });

  it('does not send again for a duplicate event', async () => {
    const duplicateStrategy: IdempotencyStrategy = {
      before: async () => 'DUPLICATE',
      afterSuccess: async () => undefined,
      onError: async () => undefined,
    };
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
      { idempotencyStrategy: duplicateStrategy },
    );

    await handler(eventBridgeEvent, lambdaContext);

    expect(emailService.sendVendorOnboardingSubmittedEmail).not.toHaveBeenCalled();
  });

  it('follows Event Platform validation when the event is invalid', async () => {
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
    );

    await handler(
      {
        source: 'vendor-service',
        'detail-type': 'VendorOnboarding.Submitted',
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
      },
      lambdaContext,
    );

    expect(emailService.sendVendorOnboardingSubmittedEmail).not.toHaveBeenCalled();
  });

  it('propagates email provider failures for retry', async () => {
    emailService.sendVendorOnboardingSubmittedEmail.mockRejectedValue(
      new Error('SES unavailable'),
    );
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
    );

    await expect(handler(eventBridgeEvent, lambdaContext)).rejects.toBeInstanceOf(
      BaseError,
    );
  });

  it('preserves the correlation ID in Event Platform context', async () => {
    emailService.sendVendorOnboardingSubmittedEmail.mockImplementation(async () => {
      expect(getContext().correlationId).toBe('corr-submit-1');
      return { messageId: 'ses-1' };
    });
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
    );

    await handler(eventBridgeEvent, lambdaContext);

    expect(emailService.sendVendorOnboardingSubmittedEmail).toHaveBeenCalledTimes(1);
  });
});
