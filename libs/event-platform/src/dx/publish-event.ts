import { z } from 'zod';

import type { EventSchemaMeta, EventTransport } from '../core/schema/define-event';
import { getSchemaMeta } from '../core/schema/schema-meta';
import type { PublishInput } from '../typings/publisher.types';
import { getDxRuntimeOrThrow } from './context';
import { publishWithPlan } from '../publishing/publish-orchestrator';
import { resolvePublishPlan } from '../publishing/routing';

export type PublishEventOverrides<Schema extends z.ZodTypeAny & { __meta: EventSchemaMeta }> =
  Omit<Partial<PublishInput<z.infer<Schema>>>, 'eventType' | 'source' | 'payload'>;

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
  const plan = resolvePublishPlan({
    schemaTransport: meta.transport,
    routing: runtime.routing,
  });

  // `meta.transport` is the registry key ('eventbridge' | 'sns' | 'sqs').
  // The value at runtime.publishers[transport] is the configured EventPublisher instance.
  const transport: EventTransport = meta.transport;
  const publisher = runtime.publishers[transport];

  if (!publisher) {
    throw new Error(
      `Publisher for transport "${transport}" not found`,
    );
  }

  const { meta: overrideMeta, ...eventOverrides } = overrides ?? {};

  await publisher.publish(
    {
      eventType: meta.eventType,
      source: meta.source,
      version: meta.eventVersion,
      ...eventOverrides,
      payload, 
      meta: {
        ...meta,
        ...overrideMeta,
      },
      ...overrides,
    },
  );
}
