import { getTemplateRegistryProvider, getEmailProvider } from '../../../common/providers/container.js';
import { environment } from '../../../common/config/environment.js';
import { readEmailDeliveryConfig } from '../config/email-delivery-config.js';
import { buildTemplateCatalog } from '../domain/template-catalog.js';
import { DynamoDbEmailDeliveryStore } from '../repositories/email-delivery.repository.js';
import type { EmailDeliveryStore } from '../idempotency/email-delivery-store.js';
import { PowertoolsEmailMetrics } from '../observability/email-metrics.js';
import { SesEmailSender } from '../ses/ses-email-sender.js';
import { EmailNotificationProcessor } from '../services/EmailNotificationProcessor.js';
import { TemplateParameterValidator } from '../templates/template-parameter-validator.js';
import { TemplateRenderer } from '../templates/template-renderer.js';
import { SesTemplateSource, TemplateResolver } from '../templates/template-resolver.js';

let deliveryStore: EmailDeliveryStore | undefined;

export function getEmailDeliveryStore(): EmailDeliveryStore {
  if (!deliveryStore) {
    const config = safeConfig();
    deliveryStore = new DynamoDbEmailDeliveryStore(
      config?.tableName ?? environment.emailDeliveryTable,
      undefined,
      config?.lockTimeoutMs ?? environment.emailDeliveryLockMs,
    );
  }
  return deliveryStore;
}

export function createDefaultEmailNotifier(): EmailNotificationProcessor {
  const config = readEmailDeliveryConfig();
  return new EmailNotificationProcessor(
    new TemplateResolver(
      new SesTemplateSource(getTemplateRegistryProvider()),
      buildTemplateCatalog(environment),
    ),
    new TemplateParameterValidator(),
    new TemplateRenderer(),
    getEmailDeliveryStore(),
    new SesEmailSender(getEmailProvider()),
    new PowertoolsEmailMetrics(),
    config,
  );
}

function safeConfig() {
  try {
    return readEmailDeliveryConfig();
  } catch {
    return undefined;
  }
}
