import { getContext } from '@api-hub/observability';
import type { LambdaInvocationContext } from '@api-hub/observability';
import { BaseError } from '@api-hub/utils';
import type { IdempotencyStrategy } from '@api-hub/event-platform';

import { EmailService } from '../services/EmailService.js';
import { createVendorEmailVerificationRequestedConsumer } from '../handlers/vendor-email-verification-requested.js';

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

const verificationDetail = {
  eventId: 'evt-verify-1',
  eventType: 'VendorEmailVerification.Requested',
  eventVersion: '1.0.0',
  timestamp: '2026-01-01T00:00:00.000Z',
  source: 'vendor-service',
  idempotencyKey: 'VendorEmailVerification.Requested:vendor-1:2026-01-01T00:00:00.000Z',
  payload: {
    vendorId: 'vendor-1',
    ownerUserId: 'user-1',
    email: 'owner@example.com',
    firstName: 'Priya',
    otp: '482193',
    expiryMinutes: 10,
    vendorStatus: 'ACTIVE' as const,
    applicationId: 'app-1',
  },
  meta: { correlationId: 'corr-confirm-1' },
};

const eventBridgeEvent = {
  source: 'vendor-service',
  'detail-type': 'VendorEmailVerification.Requested',
  detail: verificationDetail,
};

function consumerWithEmailService(emailService: EmailService, extra?: {
  idempotencyStrategy?: IdempotencyStrategy;
}) {
  return createVendorEmailVerificationRequestedConsumer({
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

describe('vendor email verification requested email consumer', () => {
  let emailService: { sendVendorEmailVerificationRequestedEmail: jest.Mock };

  beforeEach(() => {
    emailService = {
      sendVendorEmailVerificationRequestedEmail: jest.fn().mockResolvedValue({
        messageId: 'ses-1',
      }),
    };
  });

  it('resolves vendor_email_confirmation from the event type', async () => {
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
    );

    await handler(eventBridgeEvent, lambdaContext);

    expect(emailService.sendVendorEmailVerificationRequestedEmail).toHaveBeenCalledWith({
      vendorId: 'vendor-1',
      ownerUserId: 'user-1',
      email: 'owner@example.com',
      firstName: 'Priya',
      otp: '482193',
      expiryMinutes: 10,
      vendorStatus: 'ACTIVE',
      applicationId: 'app-1',
    });
  });

  it('does not accept a template id from the vendor producer', async () => {
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
    );

    await handler(
      {
        source: 'vendor-service',
        'detail-type': 'VendorEmailVerification.Requested',
        detail: {
          ...verificationDetail,
          eventId: 'evt-verify-template',
          payload: {
            ...verificationDetail.payload,
            templateId: 'vendor_email_confirmation',
          },
        },
      },
      lambdaContext,
    );

    expect(emailService.sendVendorEmailVerificationRequestedEmail).not.toHaveBeenCalled();
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

    expect(emailService.sendVendorEmailVerificationRequestedEmail).not.toHaveBeenCalled();
  });

  it('follows Event Platform validation when the event is invalid', async () => {
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
    );

    await handler(
      {
        source: 'vendor-service',
        'detail-type': 'VendorEmailVerification.Requested',
        detail: {
          ...verificationDetail,
          eventId: 'evt-invalid',
          payload: {
            ...verificationDetail.payload,
            email: 'not-an-email',
          },
        },
      },
      lambdaContext,
    );

    expect(emailService.sendVendorEmailVerificationRequestedEmail).not.toHaveBeenCalled();
  });

  it('propagates email provider failures for retry', async () => {
    emailService.sendVendorEmailVerificationRequestedEmail.mockRejectedValue(
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
    emailService.sendVendorEmailVerificationRequestedEmail.mockImplementation(async () => {
      expect(getContext().correlationId).toBe('corr-confirm-1');
      return { messageId: 'ses-1' };
    });
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
    );

    await handler(eventBridgeEvent, lambdaContext);

    expect(emailService.sendVendorEmailVerificationRequestedEmail).toHaveBeenCalledTimes(1);
  });
});
