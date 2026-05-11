import { z } from 'zod';

import type { EventSchemaMeta, EventTransport } from '../core/schema/define-event';
import { getSchemaMeta } from '../core/schema/schema-meta';
import type { PublishInput } from '../typings/publisher.types';
import { getDxRuntimeOrThrow } from './context';

export type PublishEventOverrides<Schema extends z.ZodTypeAny & { __meta: EventSchemaMeta }> =
  Omit<Partial<PublishInput<z.infer<Schema>>>, 'eventType' | 'source' | 'payload'>;

/**
 * Publishes using the SDK {@link EventPublisher} configured via {@link configureEventDx}.
 * `eventType`, default `version`, and `source` come from `eventDef.__meta`.
 */
export async function publishEvent<
  Schema extends z.ZodTypeAny & {
    __meta: EventSchemaMeta;
  },
>(
  eventDef: Schema,
  payload: z.infer<Schema>,
  overrides?: PublishEventOverrides<Schema>,
): Promise<void> {

  const meta = getSchemaMeta(eventDef);

  const runtime = getDxRuntimeOrThrow();

  const transport: EventTransport = 
    runtime.publishers.eventbridge as unknown as EventTransport;

  const publisher =
    runtime.publishers[transport];

  if (!publisher) {
    throw new Error(
      `Publisher for transport "${transport}" not found`,
    );
  }

  await publisher.publish(
    {
      eventType: meta.eventType,
      source: meta.source,
      version:   meta.eventVersion,
      payload,
      meta: {
        ...meta,
        ...overrides,
      },
    },
  );
}