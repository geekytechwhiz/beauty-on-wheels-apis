import { z } from 'zod';

import type { EventSchemaMeta } from '../core/schema/define-event';
import { getSchemaMeta } from '../core/schema/schema-meta';

import type { PublishInput } from '../typings/publisher.types';

import { getDxRuntimeOrThrow } from './context';

export type PublishEventOverrides = {
  meta?: Record<string, unknown>;

  correlationId?: string;

  idempotencyKey?: string;

  traceId?: string;

  partitionKey?: string;

  delaySeconds?: number;
};


 
export async function publishEvent<
  Schema extends z.ZodTypeAny & {
    __meta: EventSchemaMeta;
  },
>(
  eventDef: Schema,
  payload: z.infer<Schema>,
  overrides?: PublishEventOverrides,
): Promise<void> {
  const schemaMeta = getSchemaMeta(eventDef);

  const { 
    meta: runtimeMeta, 
    ...rest
  } = overrides ?? {};

  const runtime = getDxRuntimeOrThrow();

  // ---------------------------------------------------
  // Resolve transport
  // ---------------------------------------------------

  const transport =
    schemaMeta.transport ??
    runtime.defaultTransport;

  // ---------------------------------------------------
  // Resolve publisher by transport
  // ---------------------------------------------------

  const publisher =
    runtime.publishers?.[transport];

  if (!publisher) {
    throw new Error(
      `No publisher configured for transport "${transport}"`,
    );
  }

  // ---------------------------------------------------
  // Publish canonical event
  // ---------------------------------------------------

  await publisher.publish({
    eventType: schemaMeta.eventType,

    source: schemaMeta.source,

    version:
           
      schemaMeta.eventVersion,

    payload,

    meta: {
      ...(runtimeMeta ?? {}),
    },

    ...rest,
  });
}