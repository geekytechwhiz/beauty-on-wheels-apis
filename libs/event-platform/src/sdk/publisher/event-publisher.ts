import { createLogger, type Logger } from '@api-hub/logger';
import { getLoggerContext } from '@api-hub/observability';
import type { EventPublishAdapter } from './event-publish-adapter';
import type { PublishInput } from './publish-input';
import type { BaseEvent } from '../../typings/base-event.types';
import { createBaseEvent } from '../../core/event-envelope/create-base-event';
import type { PayloadSchemaRegistry } from '../../typings/consumer.types';

/** -----------------------------
 * 🔹 Helpers
 * ----------------------------- */
function serializeErr(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { value: String(err) };
}

function resolveSchema(
  schemas: PayloadSchemaRegistry | undefined,
  eventType: string,
  version: string,
) {
  const eventSchemas:any = schemas?.[eventType];

  if (!eventSchemas) {
    throw new Error(`No schemas found for eventType: ${eventType}`);
  }

  const schema = eventSchemas[version];

  if (!schema) {
    throw new Error(
      `No schema for eventType=${eventType}, version=${version}`,
    );
  }

  return schema;
}

/** -----------------------------
 * 🔹 Types
 * ----------------------------- */
export type EventPublisherDeps = {
  adapter: EventPublishAdapter;

  /** Version-aware schemas: eventType → version → schema */
  payloadSchemas?: PayloadSchemaRegistry;

  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;

  serviceName?: string;
};

/** -----------------------------
 * 🔥 Event Publisher
 * ----------------------------- */
export class EventPublisher {
  private readonly log: Pick<Logger, 'info' | 'warn' | 'error'>;

  constructor(private readonly deps: EventPublisherDeps) {
    this.log =
      deps.logger ??
      createLogger({
        service: deps.serviceName ?? 'event-publisher',
        redactPII: true,
      });
  }

  async publish<T>(input: PublishInput<T>): Promise<void> {
    /** -----------------------------
     * 🔹 Build Event (single source of truth)
     * ----------------------------- */
    const event: BaseEvent<T> = createBaseEvent({
      eventType: input.eventType,
      eventVersion: input.version ?? '1.0.0',
      payload: input.payload,
      source: input.source,

      eventId: input.eventId,
      timestamp: input.timestamp,
      idempotencyKey: input.idempotencyKey,

      meta: {
        correlationId:
          input.correlationId ?? getLoggerContext().correlationId,

        tenantId: input.meta?.tenantId,
        userId: input.meta?.userId,
        channel: input.meta?.channel,
        environment: input.meta?.environment,

        traceId: input.meta?.traceId,
        spanId: input.meta?.spanId,

        causationId: input.meta?.causationId,

        schemaRef: `${input.eventType}@${input.version ?? '1.0.0'}`,
      },
    });

    /** -----------------------------
     * 🔹 Schema Validation (version-aware)
     * ----------------------------- */
    if (this.deps.payloadSchemas) {
      try {
        const schema = resolveSchema(
          this.deps.payloadSchemas,
          event.eventType,
          event.eventVersion,
        );

        schema.parse(event.payload);
      } catch (err) {
        this.log.error({
          event: 'event_publish_schema_validation_failed',
          eventType: event.eventType,
          eventVersion: event.eventVersion,
          err: serializeErr(err),
        });
        throw err;
      }
    }

    /** -----------------------------
     * 🔹 Publish Attempt Log
     * ----------------------------- */
    this.log.info({
      event: 'event_publish_attempt',
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      eventId: event.eventId,
      source: event.source,
      correlationId: event.meta.correlationId,
    });

    /** -----------------------------
     * 🔹 Publish
     * ----------------------------- */
    try {
      await this.deps.adapter.publish(event);

      this.log.info({
        event: 'event_publish_success',
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        eventId: event.eventId,
      });
    } catch (err) {
      this.log.error({
        event: 'event_publish_error',
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        eventId: event.eventId,
        correlationId: event.meta.correlationId,
        err: serializeErr(err),
      });

      throw err;
    }
  }
}