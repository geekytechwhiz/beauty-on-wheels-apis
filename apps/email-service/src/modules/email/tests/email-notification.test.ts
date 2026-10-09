import { getContext } from '@api-hub/observability';
import type { LambdaInvocationContext } from '@api-hub/observability';
import type { IdempotencyStrategy } from '@api-hub/event-platform';

import { createEmailNotificationConsumer } from '../handlers/email-notification.js';
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
    vendorEmailConfirmationTemplateName: 'VENDOR_EMAIL_VERIFICATION',
    vendorEmailVerificationUrl: 'https://app.beautyonwheels.test/vendor/email-verification',
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

function consumerWithProcessor(
  processor: EmailNotificationProcessor,
  extra?: { idempotencyStrategy?: IdempotencyStrategy },
) {
  return createEmailNotificationConsumer({
    processor,
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
  let processor: { deliver: jest.Mock };

  beforeEach(() => {
    processor = {
      deliver: jest.fn().mockResolvedValue({ messageId: 'ses-booking-1', duplicate: false }),
    };
  });

  it('adapts a booking event from SQS into a generic email command', async () => {
    const handler = consumerWithProcessor(processor as unknown as EmailNotificationProcessor);

    const result = await handler(
      eventBridgeOnSqs({
        source: 'booking-service',
        detailType: 'Booking.Confirmed',
        detail: bookingDetail,
      }),
      lambdaContext,
    );

    expect(result.batchItemFailures).toEqual([]);
    expect(processor.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-booking-1',
        idempotencyKey: 'Booking.Confirmed:bkg-1',
        correlationId: 'corr-booking-1',
        templateName: 'BookingConfirmed',
        recipient: { email: 'customer@example.com', name: 'Ada' },
        parameters: expect.objectContaining({
          bookingId: 'bkg-1',
          bookingDate: '2026-09-20',
          totalAmount: 149.5,
        }),
      }),
    );
  });

  it('does not accept a template id from the booking producer', async () => {
    const handler = consumerWithProcessor(processor as unknown as EmailNotificationProcessor);

    await handler(
      eventBridgeOnSqs({
        source: 'booking-service',
        detailType: 'Booking.Confirmed',
        detail: {
          ...bookingDetail,
          eventId: 'evt-booking-template',
          payload: {
            ...bookingDetail.payload,
            templateId: 'SomeProducerTemplate',
          },
        },
      }),
      lambdaContext,
    );

    expect(processor.deliver).not.toHaveBeenCalled();
  });

  it('does not send again for a duplicate booking event', async () => {
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
        source: 'booking-service',
        detailType: 'Booking.Confirmed',
        detail: bookingDetail,
      }),
      lambdaContext,
    );

    expect(processor.deliver).not.toHaveBeenCalled();
  });

  it('follows Event Platform validation when the booking event is invalid', async () => {
    const handler = consumerWithProcessor(processor as unknown as EmailNotificationProcessor);

    await handler(
      eventBridgeOnSqs({
        source: 'booking-service',
        detailType: 'Booking.Confirmed',
        detail: {
          ...bookingDetail,
          eventId: 'evt-booking-invalid',
          payload: {
            ...bookingDetail.payload,
            customerEmail: 'not-an-email',
          },
        },
      }),
      lambdaContext,
    );

    expect(processor.deliver).not.toHaveBeenCalled();
  });

  it('returns the message for retry when delivery fails', async () => {
    processor.deliver.mockRejectedValue(new Error('SES unavailable'));
    const handler = consumerWithProcessor(processor as unknown as EmailNotificationProcessor);

    const result = await handler(
      eventBridgeOnSqs({
        source: 'booking-service',
        detailType: 'Booking.Confirmed',
        detail: bookingDetail,
      }),
      lambdaContext,
    );

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'mid-1' }]);
  });

  it('preserves the correlation ID in Event Platform context', async () => {
    processor.deliver.mockImplementation(async () => {
      expect(getContext().correlationId).toBe('corr-booking-1');
      return { messageId: 'ses-booking-1', duplicate: false };
    });
    const handler = consumerWithProcessor(processor as unknown as EmailNotificationProcessor);

    await handler(
      eventBridgeOnSqs({
        source: 'booking-service',
        detailType: 'Booking.Confirmed',
        detail: bookingDetail,
      }),
      lambdaContext,
    );

    expect(processor.deliver).toHaveBeenCalledTimes(1);
  });

  it('accepts a generic email notification without business branching', async () => {
    const handler = consumerWithProcessor(processor as unknown as EmailNotificationProcessor);
    const detail = {
      eventId: 'evt-123',
      eventType: 'Email.NotificationRequested',
      eventVersion: '1.0.0',
      timestamp: '2026-10-08T09:30:00.000Z',
      source: 'appointment-service',
      idempotencyKey: 'Email.NotificationRequested:ntf-1',
      payload: {
        channel: 'EMAIL',
        templateName: 'appointment-confirmation',
        locale: 'en-IN',
        notificationId: 'ntf-1',
        recipient: { email: 'customer@example.com', name: 'John' },
        parameters: {
          patientName: 'John',
          doctorName: 'Dr Smith',
          appointmentDate: '10 Oct 2026',
          appointmentTime: '10:00 AM',
        },
      },
      meta: { correlationId: 'corr-123' },
    };

    await handler(
      eventBridgeOnSqs({
        source: 'appointment-service',
        detailType: 'Email.NotificationRequested',
        detail,
      }),
      lambdaContext,
    );

    expect(processor.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-123',
        templateName: 'appointment-confirmation',
        locale: 'en-IN',
        correlationId: 'corr-123',
        recipient: { email: 'customer@example.com', name: 'John' },
      }),
    );
  });
});
