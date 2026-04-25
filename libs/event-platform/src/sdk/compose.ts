import type { BaseEvent } from '../core/event-envelope/base-event';
import { EventConsumer, type EventConsumerDeps, type HandleResult } from './consumer/event-consumer';
import { EventPublisher, type EventPublisherDeps } from './publisher/event-publisher';
import type { PublishInput } from './publisher/publish-input';

/** Everything on {@link BaseEvent} except the payload. */
export type EventHandlerMeta = Omit<BaseEvent<unknown>, 'payload'>;

/**
 * Returns a `publish` function: envelope build, optional payload schema validation, adapter send.
 * `EventPublisher` injects `correlationId` from `getLoggerContext()` when omitted.
 */
export function createPublishEvent(deps: EventPublisherDeps) {
  const publisher = new EventPublisher(deps);
  return (input: PublishInput<unknown>) => publisher.publish(input);
}

/**
 * Wraps a payload/meta handler for {@link EventConsumer#handle} (reliability only — no HTTP middleware).
 * Prefer composing the returned function with `createEventHandler` from `@api-hub/middleware`.
 */
export function toConsumerHandleFn<T = unknown>(
  handler: (payload: T, meta: EventHandlerMeta) => Promise<void>,
): (event: BaseEvent<T>) => Promise<void> {
  return async (ev) => {
    const { payload, ...meta } = ev;
    await handler(payload, meta as EventHandlerMeta);
  };
}

/**
 * Binds {@link EventConsumer} + a `(payload, meta)` handler into
 * `(rawEvent) => Promise<HandleResult>`. Pair with `createEventHandler` from `@api-hub/middleware`.
 */
export function consumeEvent(
  deps: EventConsumerDeps,
  handler: (payload: unknown, meta: EventHandlerMeta) => Promise<void>,
): (raw: unknown, _context?: unknown) => Promise<HandleResult> {
  const consumer = new EventConsumer(deps);
  return (raw) => consumer.handle(raw, toConsumerHandleFn(handler));
}

export type { EventConsumerDeps, EventPublisherDeps, HandleResult };
