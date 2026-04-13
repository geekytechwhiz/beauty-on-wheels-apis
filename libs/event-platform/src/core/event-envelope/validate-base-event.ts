import type { BaseEvent } from './base-event';

export class EventValidationError extends Error {
  constructor(
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'EventValidationError';
  }
}

const REQUIRED_KEYS = [
  'eventId',
  'eventType',
  'version',
  'timestamp',
  'source',
  'idempotencyKey',
  'payload',
] as const;

/** Ensures `value` matches the structural contract of {@link BaseEvent}. */
export function validateBaseEvent(value: unknown): BaseEvent {
  if (value === null || typeof value !== 'object') {
    throw new EventValidationError('Event must be a non-null object');
  }
  const o = value as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    if (!(key in o)) {
      throw new EventValidationError(`Missing required field: ${key}`);
    }
  }
  return value as BaseEvent;
}
