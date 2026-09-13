import {
  onEvent,
  createDefaultSqsDlqStrategy,
  BookingConfirmedEvent,
  VendorEmailVerificationRequestedEvent,
  VendorOnboardingSubmittedEvent,
  type EventConsumerDeps,
} from '@api-hub/event-platform';

import {
  getCampaignRepository,
  getEmailProvider,
  getStorageProvider,
  getTemplateRegistryProvider,
} from '../../../common/providers/container.js';
import { EMAIL_NOTIFICATION_EVENT_OPERATIONS } from '../domain/notification-templates.js';
import { EmailService } from '../services/EmailService.js';

function defaultEmailService(): EmailService {
  return new EmailService(
    getEmailProvider(),
    getTemplateRegistryProvider(),
    getStorageProvider(),
    getCampaignRepository(),
  );
}

function defaultConsumerDeps(): Partial<EventConsumerDeps> {
  const strategy = createDefaultSqsDlqStrategy();
  return {
    retry: {
      maxAttempts: 3,
      strategy: 'exponential',
      delayMs: 200,
    },
    dlq: strategy
      ? { enabled: true, strategy }
      : { enabled: false },
  };
}

export function createEmailNotificationConsumer(deps?: {
  emailService?: EmailService;
  consumer?: Partial<EventConsumerDeps>;
}) {
  const emailService = deps?.emailService ?? defaultEmailService();

  return onEvent({
    operation: EMAIL_NOTIFICATION_EVENT_OPERATIONS.CONSUME,
    consumer: {
      ...defaultConsumerDeps(),
      ...deps?.consumer,
    },
    events: [
      {
        schema: VendorOnboardingSubmittedEvent,
        handler: async (event) => {
          await emailService.sendVendorOnboardingSubmittedEmail({
            applicationId: event.applicationId,
            vendorId: event.vendorId,
            ownerUserId: event.ownerUserId,
            email: event.email,
            onboardingStatus: event.onboardingStatus,
            businessName: event.businessName,
          });
        },
      },
      {
        schema: VendorEmailVerificationRequestedEvent,
        handler: async (event) => {
          await emailService.sendVendorEmailVerificationRequestedEmail({
            vendorId: event.vendorId,
            ownerUserId: event.ownerUserId,
            email: event.email,
            firstName: event.firstName,
            otp: event.otp,
            expiryMinutes: event.expiryMinutes,
            vendorStatus: event.vendorStatus,
            applicationId: event.applicationId,
          });
        },
      },
      {
        schema: BookingConfirmedEvent,
        handler: async (event) => {
          await emailService.sendBookingConfirmedEmail({
            bookingId: event.bookingId,
            customerId: event.customerId,
            vendorId: event.vendorId,
            customerEmail: event.customerEmail,
            bookingDate: event.bookingDate,
            slotId: event.slotId,
            bookingStatus: event.bookingStatus,
            totalAmount: event.totalAmount,
            customerName: event.customerName,
            vendorName: event.vendorName,
          });
        },
      },
    ],
  });
}

export const main = createEmailNotificationConsumer();
