import { getContext } from '@api-hub/observability';
import type { LambdaInvocationContext } from '@api-hub/observability';
import { BaseError } from '@api-hub/utils';
import type { IdempotencyStrategy } from '@api-hub/event-platform';

import { EmailService } from '../services/EmailService.js';
import { createEmailNotificationConsumer } from '../handlers/email-notification.js';

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

const bookingDetail = {
  eventId: 'evt-booking-1',
  eventType: 'Booking.Confirmed',
  eventVersion: '1.0.0',
  timestamp: '2026-01-01T00:00:00.000Z',
  source: 'booking-service',
  idempotencyKey: 'Booking.Confirmed:bkg-1',
  payload: {
    bookingId: 'bkg-1',
    customerId: 'cust-1',
    vendorId: 'vendor-1',
    customerEmail: 'customer@example.com',
    bookingDate: '2026-09-20',
    slotId: 'slot-1',
    bookingStatus: 'confirmed' as const,
    totalAmount: 149.5,
    customerName: 'Ada',
    vendorName: 'ABC Car Wash',
  },
  meta: { correlationId: 'corr-booking-1' },
};

const bookingEventBridgeEvent = {
  source: 'booking-service',
  'detail-type': 'Booking.Confirmed',
  detail: bookingDetail,
};

function consumerWithEmailService(
  emailService: EmailService,
  extra?: { idempotencyStrategy?: IdempotencyStrategy },
) {
  return createEmailNotificationConsumer({
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

describe('email notification consumer', () => {
  let emailService: {
    sendVendorOnboardingSubmittedEmail: jest.Mock;
    sendBookingConfirmedEmail: jest.Mock;
  };

  beforeEach(() => {
    emailService = {
      sendVendorOnboardingSubmittedEmail: jest.fn().mockResolvedValue({
        messageId: 'ses-vendor-1',
      }),
      sendBookingConfirmedEmail: jest.fn().mockResolvedValue({
        messageId: 'ses-booking-1',
      }),
    };
  });

  it('resolves the booking confirmed template from the event type', async () => {
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
    );

    await handler(bookingEventBridgeEvent, lambdaContext);

    expect(emailService.sendBookingConfirmedEmail).toHaveBeenCalledWith({
      bookingId: 'bkg-1',
      customerId: 'cust-1',
      vendorId: 'vendor-1',
      customerEmail: 'customer@example.com',
      bookingDate: '2026-09-20',
      slotId: 'slot-1',
      bookingStatus: 'confirmed',
      totalAmount: 149.5,
      customerName: 'Ada',
      vendorName: 'ABC Car Wash',
    });
    expect(emailService.sendVendorOnboardingSubmittedEmail).not.toHaveBeenCalled();
  });

  it('does not accept a template id from the booking producer', async () => {
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
    );

    await handler(
      {
        source: 'booking-service',
        'detail-type': 'Booking.Confirmed',
        detail: {
          ...bookingDetail,
          eventId: 'evt-booking-template',
          payload: {
            ...bookingDetail.payload,
            templateId: 'SomeProducerTemplate',
          },
        },
      },
      lambdaContext,
    );

    expect(emailService.sendBookingConfirmedEmail).not.toHaveBeenCalled();
  });

  it('does not send again for a duplicate booking event', async () => {
    const duplicateStrategy: IdempotencyStrategy = {
      before: async () => 'DUPLICATE',
      afterSuccess: async () => undefined,
      onError: async () => undefined,
    };
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
      { idempotencyStrategy: duplicateStrategy },
    );

    await handler(bookingEventBridgeEvent, lambdaContext);

    expect(emailService.sendBookingConfirmedEmail).not.toHaveBeenCalled();
  });

  it('follows Event Platform validation when the booking event is invalid', async () => {
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
    );

    await handler(
      {
        source: 'booking-service',
        'detail-type': 'Booking.Confirmed',
        detail: {
          ...bookingDetail,
          eventId: 'evt-booking-invalid',
          payload: {
            ...bookingDetail.payload,
            customerEmail: 'not-an-email',
          },
        },
      },
      lambdaContext,
    );

    expect(emailService.sendBookingConfirmedEmail).not.toHaveBeenCalled();
  });

  it('propagates email provider failures for retry', async () => {
    emailService.sendBookingConfirmedEmail.mockRejectedValue(
      new Error('SES unavailable'),
    );
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
    );

    await expect(
      handler(bookingEventBridgeEvent, lambdaContext),
    ).rejects.toBeInstanceOf(BaseError);
  });

  it('preserves the correlation ID in Event Platform context', async () => {
    emailService.sendBookingConfirmedEmail.mockImplementation(async () => {
      expect(getContext().correlationId).toBe('corr-booking-1');
      return { messageId: 'ses-booking-1' };
    });
    const handler = consumerWithEmailService(
      emailService as unknown as EmailService,
    );

    await handler(bookingEventBridgeEvent, lambdaContext);

    expect(emailService.sendBookingConfirmedEmail).toHaveBeenCalledTimes(1);
  });
});
