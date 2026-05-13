import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

import type { BaseEvent } from '../../typings/base-event.types';
import type { EventBridgeAdapterConfig } from './eventbridge-adapter-config';
import { toPutEventsEntry } from './eventbridge-put-events';

export class EventBridgeAdapter {
  private readonly client: EventBridgeClient;

  constructor(
    private readonly config: EventBridgeAdapterConfig,
    client?: EventBridgeClient,
  ) {
    this.client = client ?? new EventBridgeClient({ region: process.env.AWS_REGION! });
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
