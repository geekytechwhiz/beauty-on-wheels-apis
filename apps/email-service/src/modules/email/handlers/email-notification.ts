import {
  createDefaultSqsDlqStrategy,
  onQueue,
  type BaseEvent,
  type BookingConfirmedPayload,
  type EmailNotificationRequestedPayload,
  type EventConsumerDeps,
  type VendorEmailVerificationRequestedPayload,
  type VendorOnboardingSubmittedPayload,
  BookingConfirmedEvent,
  EmailNotificationRequestedEvent,
  VendorEmailVerificationRequestedEvent,
  VendorOnboardingSubmittedEvent,
} from '@api-hub/event-platform';

import { EMAIL_NOTIFICATION_EVENT_OPERATIONS } from '../domain/notification-templates.js';
import {
  adaptBookingConfirmed,
  adaptVendorEmailVerificationRequested,
  adaptVendorOnboardingSubmitted,
  asEnvelope,
  commandFromEmailNotification,
} from '../domain/legacy-event-adapter.js';
import type { EmailNotificationProcessor } from '../services/EmailNotificationProcessor.js';
import { createDefaultEmailNotifier } from './composition.js';

function defaultConsumerDeps(): Partial<EventConsumerDeps> {
  const strategy = createDefaultSqsDlqStrategy();
  return {
    retry: {
      maxAttempts: 5,
      strategy: 'exponential',
      delayMs: 200,
    },
    dlq: strategy ? { enabled: true, strategy } : { enabled: false },
  };
}

export function createEmailNotificationConsumer(deps?: {
  processor?: EmailNotificationProcessor;
  consumer?: Partial<EventConsumerDeps>;
}) {
  const processor = deps?.processor ?? createDefaultEmailNotifier();

  return onQueue({
    operation: EMAIL_NOTIFICATION_EVENT_OPERATIONS.CONSUME,
    consumer: {
      ...defaultConsumerDeps(),
      ...deps?.consumer,
    },
    events: [
      {
        schema: EmailNotificationRequestedEvent,
        handler: async (payload, envelope) => {
          await processor.deliver(
            commandFromEmailNotification(
              payload as EmailNotificationRequestedPayload & {
                meta?: { correlationId?: string };
              },
              asEnvelope(envelope),
            ),
          );
        },
      },
      {
        schema: VendorOnboardingSubmittedEvent,
        handler: async (payload, envelope) => {
          await processor.deliver(
            adaptVendorOnboardingSubmitted(
              payload as VendorOnboardingSubmittedPayload & {
                meta?: { correlationId?: string };
              },
              asEnvelope(envelope),
            ),
          );
        },
      },
      {
        schema: VendorEmailVerificationRequestedEvent,
        handler: async (payload, envelope) => {
          await processor.deliver(
            adaptVendorEmailVerificationRequested(
              payload as VendorEmailVerificationRequestedPayload & {
                meta?: { correlationId?: string };
              },
              asEnvelope(envelope),
            ),
          );
        },
      },
      {
        schema: BookingConfirmedEvent,
        handler: async (payload, envelope) => {
          await processor.deliver(
            adaptBookingConfirmed(
              payload as BookingConfirmedPayload & {
                meta?: { correlationId?: string };
              },
              asEnvelope(envelope),
            ),
          );
        },
      },
    ],
  });
}

export const main = createEmailNotificationConsumer();

export type { BaseEvent };
