import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createChildLogger, createLogger } from '@api-hub/logger';
import type { MetadataRegistryEvent } from '../domain/events';

const baseLogger = createLogger({ service: 'metadata-registry-events' });

export class MetadataRegistryEventBridgePublisher {
  constructor(
    private readonly client: EventBridgeClient,
    private readonly eventBusName: string,
  ) {}

  async publish(event: MetadataRegistryEvent): Promise<void> {
    const logger = createChildLogger(baseLogger, { eventType: event.type });
    const response = await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.eventBusName,
            Source: 'metadata-registry-service',
            DetailType: event.type,
            Detail: JSON.stringify(event),
            Time: new Date(event.timestamp),
          },
        ],
      }),
    );

    if ((response.FailedEntryCount ?? 0) > 0) {
      logger.error({
        event: 'metadata_registry_event_publish_partial_failure',
        failedEntryCount: response.FailedEntryCount,
      });
      throw new Error('EventBridge publish failed');
    }
  }
}
