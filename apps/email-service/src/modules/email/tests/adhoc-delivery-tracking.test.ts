import type { SQSRecord } from 'aws-lambda';

import { environment } from '../../../common/config/environment.js';
import type { ICampaignRepository } from '../../../common/providers/ICampaignRepository.js';
import type { IEmailProvider } from '../../../common/providers/IEmailProvider.js';
import type { IStorageProvider } from '../../../common/providers/IStorageProvider.js';
import type { ITemplateRegistryProvider } from '../../../common/providers/ITemplateRegistryProvider.js';
import { applySesLifecycleBatch } from '../delivery/apply-ses-lifecycle.js';
import {
  readCallerIdempotencyKey,
  resolveAdhocIdempotencyKey,
} from '../domain/adhoc-idempotency.js';
import { DELIVERY_STATUS, FAILURE_CLASS } from '../domain/delivery-status.js';
import { DynamoDbEmailDeliveryStore } from '../repositories/email-delivery.repository.js';
import { getEmailDeliveryStore } from '../handlers/composition.js';
import { MemoryEmailDeliveryStore } from '../idempotency/email-delivery-store.js';
import { RecordingEmailMetrics } from '../observability/email-metrics.js';
import { EmailService } from '../services/EmailService.js';

const rawRequest = {
  to: 'recipient@example.com',
  from: 'sender@example.com',
  subject: 'Hello',
  textContent: 'Body',
};

function serviceWith(store: MemoryEmailDeliveryStore) {
  const emailProvider: jest.Mocked<
    Pick<IEmailProvider, 'sendEmail' | 'sendTemplatedEmail'>
  > = {
    sendEmail: jest.fn().mockResolvedValue({ messageId: 'ses-1' }),
    sendTemplatedEmail: jest
      .fn()
      .mockResolvedValue({ messageId: 'ses-template-1' }),
  };
  const templateRegistry = {
    getTemplate: jest.fn().mockResolvedValue({
      templateName: 'WelcomeTemplate',
      subject: 'Welcome',
      htmlContent: '<p>Hello</p>',
      textContent: 'Hello',
    }),
  } as unknown as jest.Mocked<ITemplateRegistryProvider>;
  const storage = {
    putObject: jest.fn(),
    getObject: jest.fn(),
    getObjectAsBuffer: jest.fn(),
    generatePresignedUploadUrl: jest.fn(),
  } as unknown as jest.Mocked<IStorageProvider>;
  const campaignRepo = {
    getRecipientTracking: jest.fn().mockResolvedValue(null),
    createOrUpdateRecipientTracking: jest.fn(),
    incrementBatchCounts: jest.fn(),
  } as unknown as jest.Mocked<ICampaignRepository>;
  const emailService = new EmailService(
    emailProvider as unknown as IEmailProvider,
    templateRegistry,
    storage,
    campaignRepo,
    store,
  );
  return {
    emailService,
    emailProvider,
    templateRegistry,
    storage,
    campaignRepo,
    store,
  };
}

function sqsRecord(messageId: string, detail: unknown): SQSRecord {
  return {
    messageId,
    receiptHandle: 'rh',
    body: JSON.stringify({
      source: 'aws.ses',
      'detail-type': 'Email Lifecycle',
      detail,
    }),
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '1',
      SenderId: 's',
      ApproximateFirstReceiveTimestamp: '1',
    },
    messageAttributes: {},
    md5OfBody: 'x',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123:delivery',
    awsRegion: 'us-east-1',
  };
}

describe('ad-hoc delivery tracking', () => {
  beforeEach(() => {
    environment.sesConfigurationSet = 'test-email-delivery';
    environment.defaultFromEmail = 'noreply@beautyonwheels.test';
    environment.defaultFromName = 'Beauty on Wheels';
    environment.bookingConfirmedTemplateName = 'BookingConfirmed';
    environment.vendorOnboardingTemplateName = 'VendorOnboardingSubmitted';
    environment.vendorEmailConfirmationTemplateName =
      'VENDOR_EMAIL_VERIFICATION';
  });

  it('claims, sends, markSent, and returns the SES message id', async () => {
    const store = new MemoryEmailDeliveryStore();
    const markSent = jest.spyOn(store, 'markSent');
    const { emailService, emailProvider } = serviceWith(store);

    const result = await emailService.sendAdhocEmail(rawRequest, {
      idempotencyKey: 'adhoc-1',
    });

    expect(result).toEqual({ messageId: 'ses-1' });
    expect(emailProvider.sendEmail).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith('adhoc-1', 'ses-1');
    expect(await store.recordLifecycle('ses-1', DELIVERY_STATUS.SENT)).toBe(
      'ignored',
    );
  });

  it('does not send again for a duplicate request', async () => {
    const { emailService, emailProvider } = serviceWith(
      new MemoryEmailDeliveryStore(),
    );

    const first = await emailService.sendAdhocEmail(rawRequest, {
      idempotencyKey: 'adhoc-1',
    });
    const second = await emailService.sendAdhocEmail(rawRequest, {
      idempotencyKey: 'adhoc-1',
    });

    expect(second).toEqual(first);
    expect(emailProvider.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('derives a stable key from the payload when the caller does not supply one', () => {
    const headers = { 'Idempotency-Key': ' caller-key ' };
    expect(readCallerIdempotencyKey(headers)).toBe('caller-key');
    expect(readCallerIdempotencyKey({ 'x-idempotency-key': 'alt-key' })).toBe(
      'alt-key',
    );

    const first = resolveAdhocIdempotencyKey(rawRequest);
    const second = resolveAdhocIdempotencyKey(rawRequest);
    const changed = resolveAdhocIdempotencyKey({
      ...rawRequest,
      subject: 'Different',
    });

    expect(first).toBe(second);
    expect(first.startsWith('adhoc:')).toBe(true);
    expect(changed).not.toBe(first);
    expect(
      resolveAdhocIdempotencyKey(rawRequest, { idempotencyKey: 'explicit' }),
    ).toBe('explicit');
  });

  it('does not send while a claim is in progress', async () => {
    const store = new MemoryEmailDeliveryStore(60_000);
    await store.claim({
      idempotencyKey: 'adhoc-1',
      eventId: 'adhoc-1',
      eventType: 'email.sendAdhoc',
      source: 'email-service',
      templateName: 'raw',
      recipientHash: 'hash',
    });
    const { emailService, emailProvider } = serviceWith(store);

    await expect(
      emailService.sendAdhocEmail(rawRequest, { idempotencyKey: 'adhoc-1' }),
    ).rejects.toMatchObject({ retryable: true });
    expect(emailProvider.sendEmail).not.toHaveBeenCalled();
  });

  it('does not send when a stale claim has no message id', async () => {
    const store = new MemoryEmailDeliveryStore(1_000);
    store.setNow(1_000);
    await store.claim({
      idempotencyKey: 'adhoc-1',
      eventId: 'adhoc-1',
      eventType: 'email.sendAdhoc',
      source: 'email-service',
      templateName: 'raw',
      recipientHash: 'hash',
    });
    store.setNow(5_000);
    const { emailService, emailProvider } = serviceWith(store);

    await expect(
      emailService.sendAdhocEmail(rawRequest, { idempotencyKey: 'adhoc-1' }),
    ).rejects.toMatchObject({ retryable: false });
    expect(emailProvider.sendEmail).not.toHaveBeenCalled();
  });

  it('marks a permanent SES failure and does not send again', async () => {
    const store = new MemoryEmailDeliveryStore();
    const markFailed = jest.spyOn(store, 'markFailed');
    const { emailService, emailProvider } = serviceWith(store);
    emailProvider.sendEmail.mockRejectedValueOnce(
      Object.assign(new Error('rejected'), {
        name: 'MessageRejected',
        $metadata: { httpStatusCode: 400 },
      }),
    );

    await expect(
      emailService.sendAdhocEmail(rawRequest, { idempotencyKey: 'adhoc-1' }),
    ).rejects.toThrow('rejected');
    expect(markFailed).toHaveBeenCalledWith(
      'adhoc-1',
      FAILURE_CLASS.PERMANENT,
      'MessageRejected',
    );

    await expect(
      emailService.sendAdhocEmail(rawRequest, { idempotencyKey: 'adhoc-1' }),
    ).rejects.toThrow(/will not be sent again/);
    expect(emailProvider.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('marks a retryable SES failure so a later attempt can send', async () => {
    const store = new MemoryEmailDeliveryStore();
    const markFailed = jest.spyOn(store, 'markFailed');
    const { emailService, emailProvider } = serviceWith(store);
    emailProvider.sendEmail
      .mockRejectedValueOnce(
        Object.assign(new Error('slow'), {
          name: 'TooManyRequestsException',
          $metadata: { httpStatusCode: 429 },
        }),
      )
      .mockResolvedValueOnce({ messageId: 'ses-2' });

    await expect(
      emailService.sendAdhocEmail(rawRequest, { idempotencyKey: 'adhoc-1' }),
    ).rejects.toThrow('slow');
    expect(markFailed).toHaveBeenCalledWith(
      'adhoc-1',
      FAILURE_CLASS.RETRYABLE,
      'TooManyRequestsException',
    );

    const retried = await emailService.sendAdhocEmail(rawRequest, {
      idempotencyKey: 'adhoc-1',
    });
    expect(retried.messageId).toBe('ses-2');
    expect(emailProvider.sendEmail).toHaveBeenCalledTimes(2);
  });

  it('passes the configured configuration set for raw and templated ad-hoc sends', async () => {
    const { emailService, emailProvider, templateRegistry } = serviceWith(
      new MemoryEmailDeliveryStore(),
    );
    templateRegistry.getTemplate.mockResolvedValue({
      templateName: 'WelcomeTemplate',
      subject: 'Welcome',
      htmlContent: '<p>Hello</p>',
      textContent: 'Hello',
    });

    await emailService.sendAdhocEmail(rawRequest, { idempotencyKey: 'raw-1' });
    await emailService.sendAdhocEmail(
      {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        templateName: 'WelcomeTemplate',
        templateData: { name: 'Ada' },
      },
      { idempotencyKey: 'template-1' },
    );

    expect(emailProvider.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ configurationSetName: 'test-email-delivery' }),
    );
    expect(emailProvider.sendTemplatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'WelcomeTemplate',
        configurationSetName: 'test-email-delivery',
      }),
    );
  });

  it('tracks event notification sends and leaves bulk campaign sends untracked', async () => {
    const store = new MemoryEmailDeliveryStore();
    const claim = jest.spyOn(store, 'claim');
    const { emailService, emailProvider, templateRegistry, campaignRepo } =
      serviceWith(store);
    templateRegistry.getTemplate.mockResolvedValue({
      templateName: 'BookingConfirmed',
      subject: 'Booked',
      htmlContent: '<p>Thanks</p>',
      textContent: 'Thanks',
    });
    emailProvider.sendTemplatedEmail.mockResolvedValue({
      messageId: 'ses-booking',
    });

    await emailService.sendBookingConfirmedEmail({
      bookingId: 'bkg-1',
      customerId: 'cust-1',
      vendorId: 'vendor-1',
      verificationRequestId: 'verify-1',
      customerEmail: 'customer@example.com',
      bookingDate: '2026-09-20',
      slotId: 'slot-1',
      bookingStatus: 'confirmed',
    });
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'Booking.Confirmed:bkg-1',
        eventType: 'Booking.Confirmed',
        source: 'booking-service',
      }),
    );
    expect(emailProvider.sendTemplatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ configurationSetName: 'test-email-delivery' }),
    );

    claim.mockClear();
    await emailService.sendVendorOnboardingSubmittedEmail({
      applicationId: 'app-1',
      vendorId: 'vendor-1',
      ownerUserId: 'user-1',
      email: 'owner@example.com',
      onboardingStatus: 'PENDING_REVIEW',
    });
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'VendorOnboarding.Submitted:app-1',
      }),
    );

    claim.mockClear();
    await emailService.sendVendorEmailVerificationRequestedEmail({
      vendorId: 'vendor-1',
      ownerUserId: 'user-1',
      email: 'owner@example.com',
      ownerName: 'Priya', businessName: 'ABC Car Wash', verificationUrl: 'https://app.test/verify?token=opaque',
      vendorStatus: 'PENDING_VERIFICATION',
    });
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'VendorEmailVerification.Requested:vendor-1:verify-1',
      }),
    );

    claim.mockClear();
    await emailService.sendBulkEmail({
      batchId: 'batch-1',
      campaignId: 'camp-1',
      recipientTrackingTable: 'RecipientTracking',
      batchTrackingTable: 'CampaignBatches',
      recipient: {
        email: 'bulk@example.com',
        metadata: { firstName: 'Bo', lastName: 'W' },
      },
      sender: { email: 'sender@example.com', name: 'Sender' },
      template: { name: 'temp-reg' },
      attempts: 0,
      messageId: 'sqs-1',
    });
    expect(claim).not.toHaveBeenCalled();
    const bulkCall = emailProvider.sendTemplatedEmail.mock.calls.at(-1)?.[0];
    expect(bulkCall).not.toHaveProperty('configurationSetName');
    expect(campaignRepo.createOrUpdateRecipientTracking).toHaveBeenCalled();
  });
});

describe('SES lifecycle against a tracked send', () => {
  it('ignores a duplicate Send event and then records delivery', async () => {
    const store = new MemoryEmailDeliveryStore();
    const { emailService } = serviceWith(store);
    await emailService.sendAdhocEmail(rawRequest, {
      idempotencyKey: 'adhoc-1',
    });
    const metrics = new RecordingEmailMetrics();

    const sent = await applySesLifecycleBatch(
      {
        Records: [
          sqsRecord('sqs-send', {
            eventType: 'Send',
            mail: { messageId: 'ses-1' },
          }),
        ],
      },
      store,
      metrics,
    );
    expect(sent.batchItemFailures).toEqual([]);
    expect(await store.recordLifecycle('ses-1', DELIVERY_STATUS.SENT)).toBe(
      'ignored',
    );

    const delivered = await applySesLifecycleBatch(
      {
        Records: [
          sqsRecord('sqs-delivered', {
            eventType: 'Delivery',
            mail: { messageId: 'ses-1' },
          }),
        ],
      },
      store,
      metrics,
    );
    expect(delivered.batchItemFailures).toEqual([]);
    expect(
      await store.recordLifecycle('ses-1', DELIVERY_STATUS.DELIVERED),
    ).toBe('ignored');
  });

  it('retries a lifecycle event when no delivery record exists', async () => {
    const store = new MemoryEmailDeliveryStore();
    const missing = await applySesLifecycleBatch(
      {
        Records: [
          sqsRecord('sqs-missing', {
            eventType: 'Delivery',
            mail: { messageId: 'missing' },
          }),
        ],
      },
      store,
      new RecordingEmailMetrics(),
    );
    expect(missing.batchItemFailures).toEqual([
      { itemIdentifier: 'sqs-missing' },
    ]);
    expect(
      await store.recordLifecycle('missing', DELIVERY_STATUS.DELIVERED),
    ).toBe('missing');
  });

  it('applies bounce, complaint, and reject from sent', async () => {
    const store = new MemoryEmailDeliveryStore();
    const { emailService, emailProvider } = serviceWith(store);
    emailProvider.sendEmail
      .mockResolvedValueOnce({ messageId: 'ses-bounce' })
      .mockResolvedValueOnce({ messageId: 'ses-complaint' })
      .mockResolvedValueOnce({ messageId: 'ses-reject' });
    await emailService.sendAdhocEmail(
      { ...rawRequest, to: 'bounce@example.com' },
      { idempotencyKey: 'bounce' },
    );
    await emailService.sendAdhocEmail(
      { ...rawRequest, to: 'complaint@example.com' },
      { idempotencyKey: 'complaint' },
    );
    await emailService.sendAdhocEmail(
      { ...rawRequest, to: 'reject@example.com' },
      { idempotencyKey: 'reject' },
    );

    const result = await applySesLifecycleBatch(
      {
        Records: [
          sqsRecord('sqs-bounce', {
            eventType: 'Bounce',
            mail: { messageId: 'ses-bounce' },
          }),
          sqsRecord('sqs-complaint', {
            eventType: 'Complaint',
            mail: { messageId: 'ses-complaint' },
          }),
          sqsRecord('sqs-reject', {
            eventType: 'Reject',
            mail: { messageId: 'ses-reject' },
          }),
        ],
      },
      store,
      new RecordingEmailMetrics(),
    );

    expect(result.batchItemFailures).toEqual([]);
    expect(
      await store.recordLifecycle('ses-bounce', DELIVERY_STATUS.BOUNCED),
    ).toBe('ignored');
    expect(
      await store.recordLifecycle('ses-complaint', DELIVERY_STATUS.COMPLAINED),
    ).toBe('ignored');
    expect(
      await store.recordLifecycle('ses-reject', DELIVERY_STATUS.REJECTED),
    ).toBe('ignored');
  });

  it('records rendering failures as terminal and delivery delays as non-terminal', async () => {
    const store = new MemoryEmailDeliveryStore();
    const { emailService, emailProvider } = serviceWith(store);
    emailProvider.sendEmail
      .mockResolvedValueOnce({ messageId: 'ses-rendering-failure' })
      .mockResolvedValueOnce({ messageId: 'ses-delay-delivered' })
      .mockResolvedValueOnce({ messageId: 'ses-delay-bounced' });
    await emailService.sendAdhocEmail(rawRequest, {
      idempotencyKey: 'rendering-failure',
    });
    await emailService.sendAdhocEmail(rawRequest, {
      idempotencyKey: 'delay-delivered',
    });
    await emailService.sendAdhocEmail(rawRequest, {
      idempotencyKey: 'delay-bounced',
    });

    const result = await applySesLifecycleBatch(
      {
        Records: [
          sqsRecord('sqs-rendering', {
            eventType: 'Rendering Failure',
            mail: { messageId: 'ses-rendering-failure' },
            renderingFailure: { errorMessage: 'missing template variable' },
          }),
          sqsRecord('sqs-delay-1', {
            eventType: 'DeliveryDelay',
            mail: { messageId: 'ses-delay-delivered' },
            deliveryDelay: { delayType: 'MailboxFull' },
          }),
          sqsRecord('sqs-delay-2', {
            eventType: 'DeliveryDelay',
            mail: { messageId: 'ses-delay-bounced' },
            deliveryDelay: { delayType: 'MailboxFull' },
          }),
        ],
      },
      store,
      new RecordingEmailMetrics(),
    );
    expect(result.batchItemFailures).toEqual([]);
    expect(
      await store.recordLifecycle(
        'ses-rendering-failure',
        DELIVERY_STATUS.SENT,
      ),
    ).toBe('ignored');
    expect(
      await store.recordLifecycle(
        'ses-delay-delivered',
        DELIVERY_STATUS.DELIVERY_DELAYED,
      ),
    ).toBe('ignored');
    expect(
      await store.recordLifecycle(
        'ses-delay-delivered',
        DELIVERY_STATUS.DELIVERED,
      ),
    ).toBe('updated');
    expect(
      await store.recordLifecycle('ses-delay-bounced', DELIVERY_STATUS.BOUNCED),
    ).toBe('updated');
  });

  it('retries malformed, invalid, and store-failed lifecycle records but acknowledges valid ignores', async () => {
    const store = new MemoryEmailDeliveryStore();
    const { emailService } = serviceWith(store);
    await emailService.sendAdhocEmail(rawRequest, {
      idempotencyKey: 'valid-ignore',
    });
    const failingStore = {
      ...store,
      recordLifecycle: jest
        .fn()
        .mockRejectedValue(new Error('DynamoDB unavailable')),
    } as unknown as MemoryEmailDeliveryStore;
    const malformed = sqsRecord('sqs-malformed', {
      eventType: 'Send',
      mail: { messageId: 'x' },
    });
    malformed.body = '{not-json';

    const result = await applySesLifecycleBatch(
      {
        Records: [
          malformed,
          sqsRecord('sqs-invalid', {
            eventType: 'Unknown',
            mail: { messageId: 'x' },
          }),
          sqsRecord('sqs-store', {
            eventType: 'Delivery',
            mail: { messageId: 'x' },
          }),
        ],
      },
      failingStore,
      new RecordingEmailMetrics(),
    );
    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'sqs-malformed' },
      { itemIdentifier: 'sqs-invalid' },
      { itemIdentifier: 'sqs-store' },
    ]);

    const ignored = await applySesLifecycleBatch(
      {
        Records: [
          sqsRecord('sqs-ignored', {
            eventType: 'Send',
            mail: { messageId: 'ses-1' },
          }),
        ],
      },
      store,
      new RecordingEmailMetrics(),
    );
    expect(ignored.batchItemFailures).toEqual([]);
  });
});

describe('email delivery store composition', () => {
  it('uses DynamoDbEmailDeliveryStore for Lambda handlers', () => {
    const store = getEmailDeliveryStore();
    expect(store).toBeInstanceOf(DynamoDbEmailDeliveryStore);
    expect(getEmailDeliveryStore()).toBe(store);
  });
});
