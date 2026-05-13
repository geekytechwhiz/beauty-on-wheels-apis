 
import {
  EventSerializationError,
  serializeBaseEvent as serializeBaseEventCore,
} from '../../core/event-envelope/serialize-base-event';
import {
  EventValidationError,
  validateBaseEvent,
} from '../../core/event-envelope/validate-base-event';
import { BaseEvent } from '../../typings/base-event.types';

export class SqsMessageParseError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SqsMessageParseError';
  }
}

/**
 * JSON body for SQS SendMessage — fails fast on non-serializable values (e.g. BigInt).
 */
export function serializeBaseEvent(event: BaseEvent): string {
  try {
    return serializeBaseEventCore(event);
  } catch (e) {
    if (e instanceof EventSerializationError) {
      throw new SqsMessageParseError('Failed to serialize BaseEvent for SQS', e.cause);
    }
    throw e;
  }
}

/**
 * Parse SQS message body into {@link BaseEvent}. No domain validation beyond JSON + required keys.
 */
export function parseMessageBody(body: string): BaseEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (cause) {
    throw new SqsMessageParseError('SQS message body is not valid JSON', cause);
  }
  try {
    return validateBaseEvent(parsed);
  } catch (e) {
    if (e instanceof EventValidationError) {
      throw new SqsMessageParseError(e.message, e);
    }
    throw e;
  }
}
