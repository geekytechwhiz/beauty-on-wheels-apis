import { createLogger, type Logger } from '@api-hub/logger';
import { getLoggerContext } from '@api-hub/observability';
import { validatePayloadByEventType, type PayloadSchemaRegistry } from '../../core/schema/validate';
import { buildPublishEnvelope } from './build-publish-envelope';
import type { EventPublishAdapter } from './event-publish-adapter';
import type { PublishInput } from './publish-input';

function serializeErr(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { value: String(err) };
}

export type EventPublisherDeps = {
  adapter: EventPublishAdapter;
  /** When set and non-empty, validates `event.payload` for `event.eventType` before send. */
  payloadSchemas?: PayloadSchemaRegistry;
  /**
   * Logger for publish + validation lifecycle. When omitted, a service-named root logger is used.
   */
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Default logger service name (e.g. `user-service`). */
  serviceName?: string;
};

export class EventPublisher {
  private readonly log: Pick<Logger, 'info' | 'warn' | 'error'>;

  constructor(private readonly deps: EventPublisherDeps) {
    this.log = deps.logger ?? createLogger({ service: deps.serviceName ?? 'event-publisher', redactPII: true });
  }

  async publish<T>(input: PublishInput<T>): Promise<void> {
    const event = buildPublishEnvelope({
      ...input,
      correlationId: input.correlationId ?? getLoggerContext().correlationId,
    });

    if (this.deps.payloadSchemas && Object.keys(this.deps.payloadSchemas).length > 0) {
      try {
        validatePayloadByEventType(event, this.deps.payloadSchemas);
      } catch (err) {
        this.log.error({
          event: 'event_publish_schema_validation_failed',
          eventType: event.eventType,
          err: serializeErr(err),
        });
        throw err;
      }
    }

    this.log.info({
      event: 'event_publish_attempt',
      eventType: event.eventType,
      eventId: event.eventId,
      source: event.source,
      correlationId: event.correlationId,
    });

    try {
      await this.deps.adapter.publish(event);
      this.log.info({
        event: 'event_publish_success',
        eventType: event.eventType,
        eventId: event.eventId,
      });
    } catch (err) {
      this.log.error({
        event: 'event_publish_error',
        eventType: event.eventType,
        eventId: event.eventId,
        err: serializeErr(err),
      });
      throw err;
    }
  }
}
