import type { BaseEvent } from '../../core/event-envelope/base-event';
import {
  EventValidationError,
  validateBaseEvent,
} from '../../core/event-envelope/validate-base-event';

/** Accepts a parsed object or a JSON string (transport-agnostic). */
export function parseInboundEvent(raw: unknown): BaseEvent {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch (cause) {
      throw new EventValidationError('Event is not valid JSON', { cause });
    }
  }
  return validateBaseEvent(value);
}
