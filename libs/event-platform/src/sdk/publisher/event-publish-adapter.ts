import type { EventTransport } from '../../core/schema/define-event';
import type { BaseEvent } from '../../typings/base-event.types';

/** Transport boundary: SQS / EventBridge / SNS adapters implement this shape. */
export type EventPublishAdapter = {
  readonly transport: EventTransport;
  publish(event: BaseEvent): Promise<void>;
};
