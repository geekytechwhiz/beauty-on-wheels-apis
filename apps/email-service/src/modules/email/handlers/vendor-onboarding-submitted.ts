import type { EventConsumerDeps } from '@api-hub/event-platform';

import { EmailService } from '../services/EmailService.js';
import { createEmailNotificationConsumer } from './email-notification.js';

export function createVendorOnboardingSubmittedConsumer(deps?: {
  emailService?: EmailService;
  consumer?: Partial<EventConsumerDeps>;
}) {
  return createEmailNotificationConsumer(deps);
}

export { main } from './email-notification.js';
