import { z } from 'zod';

import { getSchemaMeta } from '../core/schema/schema-meta';
import type { EventSchemaMeta } from '../core/schema/define-event';
import type { EventMeta } from '../typings/base-event.types';
import type { HandleOptions, HandleResult } from '../typings/publisher.types';

import { getDxRuntimeOrThrow } from './context';

export type OnEventHandlerArg<Schema extends z.ZodTypeAny & { __meta: EventSchemaMeta }> =
  z.infer<Schema> & { meta: EventMeta };

/**
 * Returns a Lambda-style handler wired to SDK {@link EventConsumer.handle} (parse, versioning, retries, DLQ, idempotency).
 * Application handler receives flattened `{ ...payload, meta }`.
 */
export function onEvent<Schema extends z.ZodTypeAny & { __meta: EventSchemaMeta }>(
  eventDef: Schema,
  handler: (
    input: OnEventHandlerArg<Schema>,
  ) => Promise<void>,
): (rawEvent: unknown, handleOptions?: HandleOptions) => Promise<HandleResult> {
  getSchemaMeta(eventDef);
  const { consumer } = getDxRuntimeOrThrow();

  return (rawEvent: unknown, handleOptions?: HandleOptions) =>
    consumer.handle(
      rawevent: any,
      async (baseEvent) => {
        const body =
          typeof baseEvent.payload === 'object' && baseEvent.payload !== null;
        await handler({
          ...(body ? (baseEvent.payload as Record<string, unknown>) : {}),
          meta: baseEvent.meta,
        } as OnEventHandlerArg<Schema>);
      },
      handleOptions,
    );
}
