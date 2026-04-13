import type { BaseEvent } from '../../core/event-envelope/base-event';

/** Transport boundary: SQS / EventBridge adapters both implement this shape. */
export type EventPublishAdapter = {
  publish(event: BaseEvent): Promise<void>;
};
