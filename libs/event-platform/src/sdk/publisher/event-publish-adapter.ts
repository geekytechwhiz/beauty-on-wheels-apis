import type { BaseEvent } from '../../typings/base-event.types';
import { createSnsPublishEvent } from "@api-hub/event-platform";

/** Transport boundary: SQS / EventBridge adapters both implement this shape. */
export type EventPublishAdapter = {
  publish(event: BaseEvent): Promise<void>;
};
