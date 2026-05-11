import type { BaseEvent } from '../../typings/base-event.types';

export class EventSerializationError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EventSerializationError';
  }
}

/** JSON detail/body for transports (SQS, EventBridge, etc.). */
export function serializeBaseEvent(event: BaseEvent): string {
  try {
    return JSON.stringify(event);
  } catch (cause) {
    throw new EventSerializationError('Failed to serialize BaseEvent', cause);
  }
}
