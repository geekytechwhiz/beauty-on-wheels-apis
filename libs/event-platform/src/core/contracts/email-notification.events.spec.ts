import {
  createEmailNotificationEvent,
  EMAIL_NOTIFICATION_CHANNEL,
  EMAIL_NOTIFICATION_EVENT_TYPE,
  EMAIL_NOTIFICATION_EVENT_VERSION,
  EmailNotificationRequestedEvent,
  emailNotificationIdempotencyKey,
} from './email-notification.events';
import { getRegisteredEventDefinition } from '../../governance/event-registry';
import { getSchemaMeta } from '../schema/schema-meta';

describe('EmailNotificationRequestedEvent', () => {
  const payload = {
    channel: 'EMAIL',
    templateName: 'appointment-confirmation',
    locale: 'en-IN',
    notificationId: 'ntf-1',
    recipient: { email: 'customer@example.com', name: 'John' },
    parameters: {
      patientName: 'John',
      appointmentDate: '10 Oct 2026',
    },
  };

  it('is registered as a versioned notification contract', () => {
    const meta = getSchemaMeta(EmailNotificationRequestedEvent);
    expect(meta.eventType).toBe(EMAIL_NOTIFICATION_EVENT_TYPE);
    expect(meta.eventVersion).toBe(EMAIL_NOTIFICATION_EVENT_VERSION);
    expect(meta.transport).toBe('eventbridge');
    expect(getRegisteredEventDefinition(EMAIL_NOTIFICATION_EVENT_TYPE)?.classification).toBe(
      'notification',
    );
  });

  it('accepts the uppercase channel used by existing producers and stores email', () => {
    const parsed = EmailNotificationRequestedEvent.parse(payload);
    expect(parsed.channel).toBe(EMAIL_NOTIFICATION_CHANNEL);
    expect(parsed.templateName).toBe('appointment-confirmation');
  });

  it('rejects an unsupported channel, invalid email, and extra sender fields', () => {
    expect(
      EmailNotificationRequestedEvent.safeParse({ ...payload, channel: 'sms' }).success,
    ).toBe(false);
    expect(
      EmailNotificationRequestedEvent.safeParse({
        ...payload,
        recipient: { email: 'not-an-email' },
      }).success,
    ).toBe(false);
    expect(
      EmailNotificationRequestedEvent.safeParse({ ...payload, from: 'attacker@example.com' })
        .success,
    ).toBe(false);
  });

  it('builds a stable idempotency key from notificationId without the raw address', () => {
    expect(emailNotificationIdempotencyKey('ntf-1')).toBe(
      'Email.NotificationRequested:ntf-1',
    );
    const event = createEmailNotificationEvent({
      source: 'appointment-service',
      correlationId: 'corr-1',
      templateName: 'appointment-confirmation',
      notificationId: 'ntf-1',
      recipient: { email: 'customer@example.com' },
      parameters: { patientName: 'John' },
    });
    expect(event.eventType).toBe(EMAIL_NOTIFICATION_EVENT_TYPE);
    expect(event.eventVersion).toBe(EMAIL_NOTIFICATION_EVENT_VERSION);
    expect(event.idempotencyKey).toBe('Email.NotificationRequested:ntf-1');
    expect(event.idempotencyKey).not.toContain('customer@example.com');
    expect(event.meta.correlationId).toBe('corr-1');
    expect(event.payload.channel).toBe('email');
  });
});
