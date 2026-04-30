import type { BaseEvent } from '../../typings/base-event.types';

/** Transport boundary: SQS / EventBridge adapters both implement this shape. */
export type EventPublishAdapter = {
  publish(event: BaseEvent): Promise<void>;
};
