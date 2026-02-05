import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { CanonicalLabEvent } from '../models/canonicalEvent';
import type { WebhookPayload } from '../models/webhookPayload';
import { getPartnerConfig } from './partnerRegistry.client';
import { getWebhookAdapter } from '../factories/webhookAdapter.factory';
import { UnknownPartnerError, DuplicateEventError } from '../utils/webhookErrors';
import type { Logger } from '@api-hub/logger';

export interface WebhookIngestionResult {
  acknowledged: boolean;
  eventId: string;
}

/**
 * Idempotency: in-memory placeholder. Replace with existing mechanism (e.g. DynamoDB or cache) when available.
 */
const seenEventIds = new Set<string>();

function getIdempotencyKey(partnerId: string, eventId: string): string {
  return `${partnerId}:${eventId}`;
}

export async function ingestWebhook(
  partnerId: string,
  payload: WebhookPayload,
  event: APIGatewayProxyEvent,
  logger: Logger
): Promise<WebhookIngestionResult> {
  const baseUrl = process.env.PARTNER_REGISTRY_ENDPOINT ?? '';
  const partnerConfig = await getPartnerConfig(partnerId, baseUrl);
  if (!partnerConfig) {
    throw new UnknownPartnerError(partnerId);
  }

  const adapter = getWebhookAdapter(partnerId);
  adapter.authenticate(event);
  const eventId = adapter.getEventId(payload);
  const idempotencyKey = getIdempotencyKey(partnerId, eventId);

  if (seenEventIds.has(idempotencyKey)) {
    throw new DuplicateEventError(eventId);
  }

  const canonical: CanonicalLabEvent = adapter.parseEvent(payload);
  seenEventIds.add(idempotencyKey);

  // TODO: forward canonical event to Lab Domain service (HTTP POST to LAB_DOMAIN_ENDPOINT)
  await forwardToLabDomain(canonical, logger);

  logger.info({
    event: 'webhook_ingestion_success',
    partnerId,
    eventType: canonical.eventType,
    eventId,
    correlationId: event.requestContext?.requestId,
  });

  return { acknowledged: true, eventId };
}

async function forwardToLabDomain(canonical: CanonicalLabEvent, logger: Logger): Promise<void> {
  const endpoint = process.env.LAB_DOMAIN_ENDPOINT;
  if (!endpoint) {
    logger.warn({ event: 'lab_domain_forward_skipped', reason: 'LAB_DOMAIN_ENDPOINT not set' });
    return;
  }
  // TODO: POST canonical event to Lab Domain service (stub/interface)
  logger.info({
    event: 'lab_domain_forward_stub',
    partnerId: canonical.partnerId,
    eventType: canonical.eventType,
    labOrderId: canonical.labOrderId,
  });
}
