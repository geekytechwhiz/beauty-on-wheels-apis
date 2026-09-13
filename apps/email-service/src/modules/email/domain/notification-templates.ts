import {
  BOOKING_CONFIRMED_EVENT_TYPE,
  VENDOR_EMAIL_VERIFICATION_EVENT_TYPE,
  VENDOR_ONBOARDING_EVENT_TYPE,
} from '@api-hub/event-platform';

import { environment } from '../../../common/config/environment.js';

/**
 * Email Service owns template selection. Producers publish business events only —
 * never a template id or SES template name.
 */
export const EMAIL_NOTIFICATION_EVENT_OPERATIONS = {
  CONSUME: 'email.notification.processed',
} as const;

export function resolveNotificationTemplateName(eventType: string): string {
  switch (eventType) {
    case VENDOR_ONBOARDING_EVENT_TYPE:
      return environment.vendorOnboardingTemplateName;
    case VENDOR_EMAIL_VERIFICATION_EVENT_TYPE:
      return environment.vendorEmailConfirmationTemplateName;
    case BOOKING_CONFIRMED_EVENT_TYPE:
      return environment.bookingConfirmedTemplateName;
    default:
      throw new Error(`No email template is configured for event type ${eventType}`);
  }
}
