import { createSnsPublishEvent } from "@api-hub/event-platform";

/**
 * EventBridge PutEvents wiring (repo pattern: {@link EventBridgeClient} with `region`).
 */
export type EventBridgeAdapterConfig = {
  /** Custom event bus name (PutEvents `EventBusName`). */
  eventBusName: string;
  region: string;
  /** PutEvents `Source`. */
  source: string;
  /** PutEvents `DetailType`; if omitted, `event.eventType` is used. */
  detailType?: string;
};
