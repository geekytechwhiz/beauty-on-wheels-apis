import { EventValidationError } from '../../core/event-envelope/validate-base-event';

/**
 * Unwraps AWS transport envelopes so a candidate can be validated as {@link BaseEvent}:
 * - SQS: JSON-parse `body`
 * - EventBridge: use `detail`
 * - SNS (per-record): JSON-parse `Sns.Message`
 * Returns the original `raw` if no known wrapper is detected.
 */
export function normalizeTransportToPayloadCandidate(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') {
    return raw;
  }
  const o = raw as Record<string, unknown>;

  if (
    typeof o.body === 'string' &&
    (typeof o.messageId === 'string' || typeof o.receiptHandle === 'string')
  ) {
    try {
      return JSON.parse(o.body) as unknown;
    } catch (cause) {
      throw new EventValidationError('SQS message body is not valid JSON', { cause });
    }
  }

  if (o.Sns && typeof o.Sns === 'object' && o.Sns !== null) {
    const sns = o.Sns as Record<string, unknown>;
    if (typeof sns.Message === 'string') {
      try {
        return JSON.parse(sns.Message) as unknown;
      } catch (cause) {
        throw new EventValidationError('SNS message is not valid JSON', { cause });
      }
    }
  }

  if (
    'detail' in o &&
    typeof o.source === 'string' &&
    (typeof o['detail-type'] === 'string' || typeof o.detailType === 'string')
  ) {
    return o.detail;
  }

  return raw;
}
