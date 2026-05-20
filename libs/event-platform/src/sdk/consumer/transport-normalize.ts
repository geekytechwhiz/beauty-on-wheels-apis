import { EventValidationError } from '../../core/event-envelope/validate-base-event';

/**
 * When an SQS message body is an SNS subscription notification, the inner domain
 * payload lives in the string `Message` field (JSON or opaque text).
 * @see https://docs.aws.amazon.com/sns/latest/dg/sns-message-and-json-formats.html
 */
export function unwrapSnsNotificationPayload(parsedBody: unknown): unknown {
  if (parsedBody === null || typeof parsedBody !== 'object') {
    return parsedBody;
  }
  const p = parsedBody as Record<string, unknown>;
  if (
    typeof p.Type === 'string' &&
    p.Type === 'Notification' &&
    typeof p.Message === 'string'
  ) {
    const msg = p.Message.trim();
    if (msg.startsWith('{') || msg.startsWith('[')) {
      try {
        return JSON.parse(msg) as unknown;
      } catch (cause) {
        throw new EventValidationError('SNS Message field is not valid JSON', {
          cause,
        });
      }
    }
    return p.Message;
  }
  return parsedBody;
}

/**
 * Unwraps AWS transport envelopes so a candidate can be validated as {@link BaseEvent}:
 * - SQS: JSON-parse `body`, then unwrap SNS subscription notification when present
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
      const parsed = JSON.parse(o.body) as unknown;
      return unwrapSnsNotificationPayload(parsed);
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
