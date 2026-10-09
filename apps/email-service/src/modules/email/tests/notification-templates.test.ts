import {
  BOOKING_CONFIRMED_EVENT_TYPE,
  VENDOR_EMAIL_VERIFICATION_EVENT_TYPE,
  VENDOR_ONBOARDING_EVENT_TYPE,
} from '@api-hub/event-platform';

import { environment } from '../../../common/config/environment.js';
import { resolveNotificationTemplateName } from '../domain/notification-templates.js';

jest.mock('../../../common/config/environment.js', () => ({
  environment: {
    vendorOnboardingTemplateName: 'VendorOnboardingSubmitted',
    vendorEmailConfirmationTemplateName: 'VENDOR_EMAIL_VERIFICATION',
    vendorEmailVerificationUrl: 'https://app.beautyonwheels.test/vendor/email-verification',
    bookingConfirmedTemplateName: 'BookingConfirmed',
  },
}));

describe('resolveNotificationTemplateName', () => {
  it('maps vendor onboarding to the email-owned SES template', () => {
    expect(resolveNotificationTemplateName(VENDOR_ONBOARDING_EVENT_TYPE)).toBe(
      environment.vendorOnboardingTemplateName,
    );
  });

  it('maps vendor email verification to the email-owned SES template', () => {
    expect(
      resolveNotificationTemplateName(VENDOR_EMAIL_VERIFICATION_EVENT_TYPE),
    ).toBe(environment.vendorEmailConfirmationTemplateName);
    expect(environment.vendorEmailConfirmationTemplateName).toBe(
      'VENDOR_EMAIL_VERIFICATION',
    );
  });

  it('maps booking confirmed to the email-owned SES template', () => {
    expect(resolveNotificationTemplateName(BOOKING_CONFIRMED_EVENT_TYPE)).toBe(
      environment.bookingConfirmedTemplateName,
    );
  });

  it('does not take a template id from the caller', () => {
    expect(() => resolveNotificationTemplateName('SomeProducerTemplate')).toThrow(
      'No email template is configured for event type SomeProducerTemplate',
    );
  });
});
