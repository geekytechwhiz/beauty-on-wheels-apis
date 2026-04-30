import type { BaseEvent } from '../../typings/base-event.types';
import {
  EventValidationError,
  validateBaseEvent,
} from '../../core/event-envelope/validate-base-event';
import { normalizeTransportToPayloadCandidate } from './transport-normalize';

export type ParseInboundOptions = {
  /**
   * When the normalized value is not a valid {@link BaseEvent}, use this
   * (e.g. legacy SQS / EventBridge domain payloads) with access to the original `raw` record.
   */
  mapRawToBaseEvent?: (raw: unknown) => BaseEvent;
};

/**
 * Unwraps common Lambda transports, then validates {@link BaseEvent}.
 * `raw` may be a string (JSON) or a transport record (SQS, EventBridge, SNS per-record).
 */
export function parseInboundEvent(raw: unknown, options?: ParseInboundOptions): BaseEvent {
  const candidate = normalizeTransportToPayloadCandidate(raw);
  let value: unknown = candidate;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch (cause) {
      throw new EventValidationError('Event is not valid JSON', { cause });
    }
  }
  try {
    return validateBaseEvent(value);
  } catch (error) {
    if (options?.mapRawToBaseEvent) {
      return options.mapRawToBaseEvent(raw);
    }
    throw error;
  }
}
