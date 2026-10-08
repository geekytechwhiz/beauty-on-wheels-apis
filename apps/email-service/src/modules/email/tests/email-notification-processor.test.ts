import { SesPermanentError, SesRetryableError } from '../domain/errors.js';
import { MemoryEmailDeliveryStore } from '../idempotency/email-delivery-store.js';
import { classifySesError } from '../ses/classify-ses-error.js';
import { SesEmailSender } from '../ses/ses-email-sender.js';
import { EmailNotificationProcessor } from '../services/EmailNotificationProcessor.js';
import { RecordingEmailMetrics } from '../observability/email-metrics.js';
import { TemplateParameterValidator } from '../templates/template-parameter-validator.js';
import { TemplateRenderer } from '../templates/template-renderer.js';
import { TemplateResolver } from '../templates/template-resolver.js';
import { TEMPLATE_PARAMETER_TYPE } from '../domain/template-catalog.js';
import { createEmailDeliveryHandler } from '../handlers/email-delivery.js';
import { readEmailDeliveryConfig } from '../config/email-delivery-config.js';

const config = {
  fromEmail: 'noreply@beautyonwheels.test',
  fromName: 'Beauty on Wheels',
  replyTo: ['support@beautyonwheels.test'],
  configurationSetName: 'email-delivery',
  unsubscribeUrl: '',
  lockTimeoutMs: 1_000,
  tableName: 'email-delivery',
};

function processorWith(store = new MemoryEmailDeliveryStore(1_000)) {
  const sender = {
    sendEmail: jest.fn().mockResolvedValue({ messageId: 'ses-1' }),
  };
  const metrics = new RecordingEmailMetrics();
  const notification = new EmailNotificationProcessor(
    new TemplateResolver(
      {
        getTemplate: async () => ({
          templateName: 'appointment-confirmation',
          subject: 'Hello {{patientName}}',
          htmlContent: '<p>{{patientName}} {{appointmentDate}} {{appointmentTime}}</p>',
          textContent: '{{patientName}} {{appointmentDate}} {{appointmentTime}}',
        }),
      },
      {
        'appointment-confirmation': {
          active: true,
          version: '1',
          parameters: [
            { name: 'patientName', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
            { name: 'appointmentDate', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
            { name: 'appointmentTime', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
          ],
        },
      },
    ),
    new TemplateParameterValidator(),
    new TemplateRenderer(),
    store,
    new SesEmailSender(sender),
    metrics,
    config,
  );
  return { notification, sender, metrics, store };
}

const command = {
  eventId: 'evt-1',
  eventType: 'Email.NotificationRequested',
  source: 'appointment-service',
  occurredAt: '2026-10-08T09:30:00.000Z',
  correlationId: 'corr-1',
  idempotencyKey: 'Email.NotificationRequested:ntf-1',
  templateName: 'appointment-confirmation',
  recipient: { email: 'customer@example.com', name: 'John' },
  parameters: {
    patientName: 'John',
    appointmentDate: '10 Oct 2026',
    appointmentTime: '10:00 AM',
  },
};

describe('EmailNotificationProcessor', () => {
  it('renders and sends once, then skips a duplicate', async () => {
    const { notification, sender, metrics } = processorWith();
    const first = await notification.deliver(command);
    const second = await notification.deliver(command);

    expect(first).toEqual({ messageId: 'ses-1', duplicate: false });
    expect(second).toEqual({ messageId: 'ses-1', duplicate: true });
    expect(sender.sendEmail).toHaveBeenCalledTimes(1);
    expect(sender.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        fromEmail: 'noreply@beautyonwheels.test',
        replyToAddresses: ['support@beautyonwheels.test'],
        toAddresses: ['customer@example.com'],
        subject: 'Hello John',
        htmlBody: '<p>John 10 Oct 2026 10:00 AM</p>',
        configurationSetName: 'email-delivery',
      }),
    );
    expect(metrics.counts).toContain('SesSuccess');
    expect(metrics.counts).toContain('DuplicateSkips');
  });

  it('does not call SES when required parameters are missing', async () => {
    const { notification, sender } = processorWith();
    await expect(
      notification.deliver({
        ...command,
        idempotencyKey: 'missing-params',
        parameters: { patientName: 'John' },
      }),
    ).rejects.toThrow(/appointmentDate/);
    expect(sender.sendEmail).not.toHaveBeenCalled();
  });

  it('classifies SES throttling as retryable and a rejection as permanent', async () => {
    expect(classifySesError(Object.assign(new Error('slow'), { name: 'TooManyRequestsException' }))).toBeInstanceOf(
      SesRetryableError,
    );
    expect(classifySesError(Object.assign(new Error('nope'), { name: 'MessageRejected' }))).toBeInstanceOf(
      SesPermanentError,
    );

    const { notification, sender, store } = processorWith();
    sender.sendEmail.mockRejectedValueOnce(
      Object.assign(new Error('slow'), { name: 'TooManyRequestsException' }),
    );
    await expect(notification.deliver(command)).rejects.toBeInstanceOf(SesRetryableError);

    sender.sendEmail.mockResolvedValueOnce({ messageId: 'ses-2' });
    const retried = await notification.deliver(command);
    expect(retried.messageId).toBe('ses-2');
    expect(store).toBeDefined();
  });

  it('does not send again while another worker holds a fresh claim', async () => {
    const store = new MemoryEmailDeliveryStore(60_000);
    const { notification } = processorWith(store);
    await store.claim({
      idempotencyKey: command.idempotencyKey,
      eventId: command.eventId,
      eventType: command.eventType,
      source: command.source,
      templateName: command.templateName,
      recipientHash: 'abc',
    });
    await expect(notification.deliver(command)).rejects.toMatchObject({ retryable: true });
  });

  it('does not resend when a stale claim has no message id', async () => {
    const store = new MemoryEmailDeliveryStore(1_000);
    store.setNow(1_000);
    await store.claim({
      idempotencyKey: command.idempotencyKey,
      eventId: command.eventId,
      eventType: command.eventType,
      source: command.source,
      templateName: command.templateName,
      recipientHash: 'abc',
    });
    store.setNow(5_000);
    const { notification, sender } = processorWith(store);
    await expect(notification.deliver(command)).rejects.toMatchObject({ retryable: false });
    expect(sender.sendEmail).not.toHaveBeenCalled();
  });
});

describe('email delivery lifecycle', () => {
  it('records a bounce for a known SES message and retries when the row is missing', async () => {
    const store = new MemoryEmailDeliveryStore();
    const { notification } = processorWith(store);
    await notification.deliver(command);
    const handler = createEmailDeliveryHandler({
      store,
      metrics: new RecordingEmailMetrics(),
    });
    const bounce = await handler({
      Records: [
        {
          messageId: 'sqs-1',
          receiptHandle: 'rh',
          body: JSON.stringify({
            source: 'aws.ses',
            'detail-type': 'Email Bounced',
            detail: { eventType: 'Bounce', mail: { messageId: 'ses-1' } },
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
        },
      ],
    });
    expect(bounce.batchItemFailures).toEqual([]);
    const missing = await handler({
      Records: [
        {
          messageId: 'sqs-2',
          receiptHandle: 'rh',
          body: JSON.stringify({
            source: 'aws.ses',
            'detail-type': 'Email Delivered',
            detail: { eventType: 'Delivery', mail: { messageId: 'missing' } },
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
        },
      ],
    });
    expect(missing.batchItemFailures).toEqual([{ itemIdentifier: 'sqs-2' }]);
  });
});

describe('email delivery configuration', () => {
  it('rejects an invalid from address', () => {
    expect(() =>
      readEmailDeliveryConfig({
        ...config,
        defaultFromEmail: 'not-an-email',
        defaultFromName: 'Beauty on Wheels',
        sesReplyTo: '',
        sesConfigurationSet: '',
        sesUnsubscribeUrl: '',
        emailDeliveryLockMs: 150000,
        emailDeliveryTable: 'email-delivery',
      } as never),
    ).toThrow(/DEFAULT_FROM_EMAIL/);
  });
});
