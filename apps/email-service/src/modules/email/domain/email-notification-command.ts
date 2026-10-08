import type { EventMeta } from '@api-hub/event-platform';

export type EmailNotificationCommand = {
  eventId: string;
  eventType: string;
  source: string;
  occurredAt: string;
  correlationId?: string;
  idempotencyKey: string;
  templateName: string;
  locale?: string;
  templateVersion?: string;
  recipient: {
    email: string;
    name?: string;
  };
  cc?: string[];
  bcc?: string[];
  parameters: Record<string, unknown>;
};

export type EnvelopeIdentity = {
  eventId: string;
  eventType: string;
  source: string;
  timestamp: string;
  idempotencyKey: string;
  meta?: EventMeta;
};
