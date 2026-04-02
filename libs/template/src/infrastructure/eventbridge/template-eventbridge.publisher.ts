import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createChildLogger, createLogger } from '@api-hub/logger';
import type { TemplateEvent } from '../../domain';
import type { TemplateEventPublisher } from '../../application';

const baseLogger = createLogger({ service: 'template-event-publisher' });

export class TemplateEventBridgePublisher implements TemplateEventPublisher {
  constructor(
    private readonly client: EventBridgeClient,
    private readonly eventBusName: string,
  ) {}

  async publish(event: TemplateEvent): Promise<void> {
    const logger = createChildLogger(baseLogger, {
      eventType: event.type,
      templateId: event.templateId,
      orgId: event.orgId,
      version: event.version,
    });

    try {
      const response = await this.client.send(
        new PutEventsCommand({
          Entries: [
            {
              EventBusName: this.eventBusName,
              Source: 'template-service',
              DetailType: event.type,
              Detail: JSON.stringify(event),
              Time: new Date(event.timestamp),
            },
          ],
        }),
      );

      if ((response.FailedEntryCount ?? 0) > 0) {
        logger.error({
          event: 'template_event_publish_partial_failure',
          failedEntryCount: response.FailedEntryCount,
        });
        throw new Error(`Template event publish failed for ${response.FailedEntryCount} entries`);
      }
    } catch (error) {
      logger.error({
        event: 'template_event_publish_failed',
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { name: 'UnknownError', message: String(error) },
      });
      throw error;
    }
  }
}
