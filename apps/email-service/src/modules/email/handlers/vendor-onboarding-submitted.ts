import type { EventConsumerDeps } from '@api-hub/event-platform';

import type { EmailNotificationProcessor } from '../services/EmailNotificationProcessor.js';
import { createEmailNotificationConsumer } from './email-notification.js';

export function createVendorOnboardingSubmittedConsumer(deps?: {
  processor?: EmailNotificationProcessor;
  consumer?: Partial<EventConsumerDeps>;
}) {
  return createEmailNotificationConsumer(deps);
}

export { main } from './email-notification.js';
