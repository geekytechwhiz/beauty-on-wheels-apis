import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { sha256Hex } from '@api-hub/utils';

import { buildPublishEnvelope } from '../../sdk/publisher/build-publish-envelope';
import type { BaseEvent } from '../../typings/base-event.types';
import { registerEventDefinition } from '../../governance/event-registry';
import { defineEvent } from '../schema/define-event';

export const EMAIL_NOTIFICATION_EVENT_TYPE = 'Email.NotificationRequested' as const;
export const EMAIL_NOTIFICATION_EVENT_VERSION = '1.0.0' as const;
/**
 * Contract owner. Producers set their own `source` on the envelope.
 * The consumer matches `eventType`, not this value.
 */
export const EMAIL_NOTIFICATION_EVENT_SOURCE = 'email-service' as const;
export const EMAIL_NOTIFICATION_CHANNEL = 'email' as const;

/** Middleware / logs `operation` — must end with `.processed`. */
export const EMAIL_NOTIFICATION_EVENT_OPERATIONS = {
  CONSUME: 'email.notification.processed',
} as const;

const parameterValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const EmailNotificationRequestedPayloadSchema = z
  .object({
    channel: z.preprocess(
      (value) => (typeof value === 'string' ? value.toLowerCase() : value),
      z.literal(EMAIL_NOTIFICATION_CHANNEL),
    ),
    templateName: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    locale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .optional(),
    templateVersion: z.string().min(1).max(32).optional(),
    notificationId: z.string().min(1).max(128).optional(),
    recipient: z
      .object({
        email: z.string().email(),
        name: z.string().min(1).max(200).optional(),
      })
      .strict(),
    parameters: z.record(
      z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
      parameterValueSchema,
    ),
    cc: z.array(z.string().email()).max(50).optional(),
    bcc: z.array(z.string().email()).max(50).optional(),
  })
  .strict();

export type EmailNotificationRequestedPayload = z.infer<
  typeof EmailNotificationRequestedPayloadSchema
>;

export const EmailNotificationRequestedEvent = defineEvent(
  EmailNotificationRequestedPayloadSchema,
  {
    eventType: EMAIL_NOTIFICATION_EVENT_TYPE,
    eventVersion: EMAIL_NOTIFICATION_EVENT_VERSION,
    source: EMAIL_NOTIFICATION_EVENT_SOURCE,
    transport: 'eventbridge',
  },
);

export function emailNotificationIdempotencyKey(notificationId: string): string {
  return `${EMAIL_NOTIFICATION_EVENT_TYPE}:${notificationId}`;
}

export type CreateEmailNotificationEventInput = {
  source: string;
  correlationId: string;
  templateName: string;
  recipient: { email: string; name?: string };
  parameters: Record<string, string | number | boolean>;
  locale?: string;
  templateVersion?: string;
  notificationId?: string;
  eventId?: string;
  idempotencyKey?: string;
  occurredAt?: string;
  cc?: string[];
  bcc?: string[];
};

/**
 * Builds the platform envelope for a generic email notification.
 * Domain services publish this; they do not call SES.
 * The idempotency key prefers `notificationId` and never stores the raw recipient address.
 */
export function createEmailNotificationEvent(
  input: CreateEmailNotificationEventInput,
): BaseEvent<EmailNotificationRequestedPayload> {
  const eventId = input.eventId ?? randomUUID();
  const recipientHash = sha256Hex(input.recipient.email.trim().toLowerCase()).slice(0, 16);
  const idempotencyKey =
    input.idempotencyKey ??
    (input.notificationId
      ? emailNotificationIdempotencyKey(input.notificationId)
      : `${eventId}:${input.templateName}:${recipientHash}`);

  const payload: EmailNotificationRequestedPayload = {
    channel: EMAIL_NOTIFICATION_CHANNEL,
    templateName: input.templateName,
    recipient: input.recipient,
    parameters: input.parameters,
    ...(input.locale ? { locale: input.locale } : {}),
    ...(input.templateVersion ? { templateVersion: input.templateVersion } : {}),
    ...(input.notificationId ? { notificationId: input.notificationId } : {}),
    ...(input.cc ? { cc: input.cc } : {}),
    ...(input.bcc ? { bcc: input.bcc } : {}),
  };

  return buildPublishEnvelope({
    eventId,
    eventType: EMAIL_NOTIFICATION_EVENT_TYPE,
    version: EMAIL_NOTIFICATION_EVENT_VERSION,
    source: input.source,
    timestamp: input.occurredAt,
    idempotencyKey,
    payload,
    meta: { correlationId: input.correlationId },
  });
}

registerEventDefinition({
  eventType: EMAIL_NOTIFICATION_EVENT_TYPE,
  eventVersion: EMAIL_NOTIFICATION_EVENT_VERSION,
  source: EMAIL_NOTIFICATION_EVENT_SOURCE,
  transport: 'eventbridge',
  classification: 'notification',
  ownerTeam: 'email',
  compatibility: 'backward',
});
