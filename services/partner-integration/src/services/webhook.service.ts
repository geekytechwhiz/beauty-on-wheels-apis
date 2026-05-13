import { createWebhookAdapter, IdempotencyService } from '@api-hub/lab-integration';
import type { CanonicalLabWebhookResult, WebhookHeaders } from '@api-hub/lab-integration';
import type { Logger } from '@api-hub/observability';
import { getPartnerConfig } from './partnerRegistry.client';
import { mapRegistryConfigToLibConfig } from '../config/partner-config.mapper';
import { publishLabEvent } from './eventBridge.client';
import { getSecretValue, parseSecretAsJson } from '@api-hub/lab-integration';

const idempotencyService = new IdempotencyService(
  process.env.IDEMPOTENCY_TABLE_NAME ?? 'partner-integration-idempotency'
);

export interface ProcessInboundWebhookResult {
  accepted: boolean;
  eventId?: string;
  reason?: string;
}

/**
 * Get webhook secret key from partner credentials.
 * For Orange Health, the webhook secret is stored in the credentials secret.
 */
async function getWebhookSecret(
  partnerId: string,
  authConfig?: { credentialsSecretArn?: string }
): Promise<string | undefined> {
  if (!authConfig?.credentialsSecretArn) {
    return undefined;
  }

  try {
    const rawSecret = await getSecretValue(authConfig.credentialsSecretArn);
    const secretJson = parseSecretAsJson(rawSecret);
    // Try common keys for webhook secret
    return (
      (secretJson.webhookSecret as string) ||
      (secretJson.webhook_secret as string) ||
      (secretJson.secretKey as string) ||
      (secretJson.secret_key as string)
    );
  } catch (error) {
    // Log but don't fail - signature validation will fail if secret is required
    return undefined;
  }
}

/**
 * Process inbound lab webhook: resolve partner, parse with adapter, idempotency check, publish to EventBridge.
 * @param partnerId - Partner identifier
 * @param body - Parsed JSON body
 * @param logger - Logger instance
 * @param headers - Optional webhook headers (for signature validation and idempotency)
 * @param rawBody - Optional raw body string (for signature validation)
 */
export async function processInboundWebhook(
  partnerId: string,
  body: unknown,
  logger: Logger,
  headers?: WebhookHeaders,
  rawBody?: string
): Promise<ProcessInboundWebhookResult> {
  const registryConfig = await getPartnerConfig(partnerId);
  const libConfig = mapRegistryConfigToLibConfig(registryConfig);
  const adapter = createWebhookAdapter(libConfig.adapterKey);

  // Get webhook secret for signature validation (if required)
  const webhookSecret = await getWebhookSecret(partnerId, registryConfig.authConfig);

  // Parse payload with options (headers, raw body, secret)
  const parsed = adapter.parsePayload(body, {
    headers,
    rawBody,
    secretKey: webhookSecret,
  });

  if (!parsed) {
    // Check if this might be a signature validation failure
    const signature = headers?.['x-oh-signature'] || headers?.['X-OH-Signature'];
    if (signature && webhookSecret) {
      logger.warn({
        event: 'lab_webhook_signature_invalid',
        partnerId,
        message: 'Webhook signature validation failed or payload invalid',
      });
      return { accepted: false, reason: 'INVALID_SIGNATURE' };
    }
    return { accepted: false, reason: 'INVALID_PAYLOAD' };
  }

  const eventId = parsed.eventId;
  const idempotencyKey = `webhook:${partnerId}:${eventId}`;
  const cached = await idempotencyService.getResult<ProcessInboundWebhookResult>(idempotencyKey);
  if (cached) {
    logger.info({ event: 'lab_webhook_idempotent_skip', eventId, partnerId });
    return cached;
  }

  const payload: CanonicalLabWebhookResult = {
    ...parsed,
    partnerId,
  };
  await publishLabEvent(payload, logger);
  const result: ProcessInboundWebhookResult = { accepted: true, eventId };
  await idempotencyService.storeResult(idempotencyKey, result);
  return result;
}
