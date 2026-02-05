import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { CanonicalLabEvent } from '../models/canonicalEvent';
import type { WebhookPayload } from '../models/webhookPayload';

/**
 * Contract for partner-specific lab webhook adapters.
 */
export interface LabWebhookAdapter {
  authenticate(req: APIGatewayProxyEvent): void;
  parseEvent(payload: WebhookPayload): CanonicalLabEvent;
  getEventId(payload: WebhookPayload): string;
}
