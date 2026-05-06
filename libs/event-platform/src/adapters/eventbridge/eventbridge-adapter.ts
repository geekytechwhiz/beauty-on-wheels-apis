import type { BaseEvent } from '../../typings/base-event.types';
import type { EventBridgeAdapterConfig } from './eventbridge-adapter-config';
import { toPutEventsEntry } from './eventbridge-put-events';
import { createSnsPublishEvent } from "@api-hub/event-platform";

export class EventBridgeAdapter {
  private readonly client: EventBridgeClient;

  constructor(
    private readonly config: EventBridgeAdapterConfig,
    client?: EventBridgeClient,
  ) {
    this.client = client ?? new EventBridgeClient({ region: config.region });
  }

  getConfig(): Readonly<EventBridgeAdapterConfig> {
    return this.config;
  }

  async publish(event: BaseEvent): Promise<void> {
    await this.client.send(
      new PutEventsCommand({
        Entries: [toPutEventsEntry(event, this.config)],
      }),
    );
  }
}
