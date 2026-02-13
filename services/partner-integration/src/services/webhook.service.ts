import { createWebhookAdapter, IdempotencyService } from '@api-hub/lab-integration';
import type { CanonicalLabWebhookResult } from '@api-hub/lab-integration';
import type { Logger } from '@api-hub/logger';
import { getPartnerConfig } from './partnerRegistry.client';
import { mapRegistryConfigToLibConfig } from '../config/partner-config.mapper';
import { publishLabEvent } from './eventBridge.client';

const idempotencyService = new IdempotencyService(
  process.env.IDEMPOTENCY_TABLE_NAME ?? 'partner-integration-idempotency'
);

export interface ProcessInboundWebhookResult {
  accepted: boolean;
  eventId?: string;
}

/**
 * Process inbound lab webhook: resolve partner, parse with adapter, idempotency check, publish to EventBridge.
 */
export async function processInboundWebhook(
  partnerId: string,
  body: unknown,
  logger: Logger
): Promise<ProcessInboundWebhookResult> {
  const registryConfig = await getPartnerConfig(partnerId);
  const libConfig = mapRegistryConfigToLibConfig(registryConfig);
  const adapter = createWebhookAdapter(libConfig.adapterKey);
  const parsed = adapter.parsePayload(body);

  if (!parsed) {
    return { accepted: false };
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
