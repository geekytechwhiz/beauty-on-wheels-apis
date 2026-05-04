import { z } from 'zod';

import { getSchemaMeta } from '../core/schema/schema-meta';
import type { EventSchemaMeta } from '../core/schema/define-event';
import type { PublishInput } from '../typings/publisher.types';

import { getDxRuntimeOrThrow } from './context';

export type PublishEventOverrides<Schema extends z.ZodTypeAny & { __meta: EventSchemaMeta }> =
  Omit<Partial<PublishInput<z.infer<Schema>>>, 'eventType' | 'source' | 'payload'>;

/**
 * Publishes using the SDK {@link EventPublisher} configured via {@link configureEventDx}.
 * `eventType`, default `version`, and `source` come from `eventDef.__meta`.
 */
export async function publishEvent<Schema extends z.ZodTypeAny & { __meta: EventSchemaMeta }>(
  eventDef: Schema,
  payload: z.infer<Schema>,
  overrides?: PublishEventOverrides<Schema>,
): Promise<void> {
  const meta = getSchemaMeta(eventDef);
  const { version: versionOverride, ...rest } = overrides ?? {};
  const { publisher } = getDxRuntimeOrThrow();

  await publisher.publish({
    eventType: meta.eventType,
    source: meta.source,
    version: versionOverride ?? meta.eventVersion,
    payload,
    ...rest,
  });
}
