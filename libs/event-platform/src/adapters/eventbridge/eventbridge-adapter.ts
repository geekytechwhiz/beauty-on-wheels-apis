import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';

import type { BaseEvent } from '../../core/event-envelope/base-event';
import type { EventBridgeAdapterConfig } from './eventbridge-adapter-config';
import { toPutEventsEntry } from './eventbridge-put-events';

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
