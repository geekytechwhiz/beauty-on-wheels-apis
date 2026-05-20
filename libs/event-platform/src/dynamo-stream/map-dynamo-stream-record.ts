import type { z } from 'zod';

import { EventValidationError } from '../core/event-envelope/validate-base-event';
import { getSchemaMeta } from '../core/schema/schema-meta';
import type { BaseEvent } from '../typings/base-event.types';

import type { NormalizedDynamoStreamEvent } from './normalized-dynamo-stream-event';
import {
  isDynamoDbStreamRecord,
  normalizeDynamoStreamRecord,
} from './normalize-dynamo-stream-record';
import { StreamRecordFilteredError } from './stream-record-filtered.error';

export type DynamoStreamEventNameFilter =
  | 'INSERT'
  | 'MODIFY'
  | 'REMOVE'
  | ReadonlyArray<'INSERT' | 'MODIFY' | 'REMOVE'>
  | ((eventName: string) => boolean);

export type DynamoStreamRoute = {
  /**
   * Table resource name (suffix match), regex, or predicate on the name parsed from `eventSourceARN`.
   * `undefined` matches any table.
   */
  table?: string | RegExp | ((tableName: string) => boolean);
  eventName: DynamoStreamEventNameFilter;
  schema: z.ZodTypeAny;
};

export function matchDynamoStreamTable(
  filter: DynamoStreamRoute['table'],
  tableName: string,
): boolean {
  if (filter === undefined) {
    return true;
  }
  if (typeof filter === 'function') {
    return filter(tableName);
  }
  if (filter instanceof RegExp) {
    return filter.test(tableName);
  }
  const t = tableName.toLowerCase();
  const f = filter.toLowerCase();
  return t.includes(f) || t.endsWith(f);
}

export function matchDynamoStreamEventName(
  filter: DynamoStreamEventNameFilter,
  eventName: string,
): boolean {
  if (typeof filter === 'function') {
    return filter(eventName);
  }
  if (typeof filter === 'string') {
    return filter === eventName;
  }
  return (filter as readonly string[]).includes(eventName);
}

export function matchDynamoStreamRoute(
  norm: NormalizedDynamoStreamEvent,
  route: DynamoStreamRoute,
): boolean {
  const table = norm.tableName ?? '';
  if (!matchDynamoStreamTable(route.table, table)) {
    return false;
  }
  return matchDynamoStreamEventName(route.eventName, String(norm.eventName));
}

function payloadFromNormalized(norm: NormalizedDynamoStreamEvent): unknown {
  const name = String(norm.eventName);
  if (name === 'REMOVE') {
    return norm.oldImage ?? norm.keys;
  }
  if (name === 'INSERT') {
    return norm.newImage ?? norm.keys;
  }
  if (name === 'MODIFY') {
    return norm.newImage ?? norm.oldImage ?? norm.keys;
  }
  return norm.newImage ?? norm.oldImage ?? norm.keys;
}

function isoTimestamp(norm: NormalizedDynamoStreamEvent): string {
  const ms = norm.approximateCreationDateTime;
  if (typeof ms === 'number' && Number.isFinite(ms)) {
    return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

export function buildBaseEventFromNormalizedStream(
  norm: NormalizedDynamoStreamEvent,
  schema: z.ZodTypeAny,
): BaseEvent<unknown> {
  const meta = getSchemaMeta(schema);
  const rawPayload = payloadFromNormalized(norm);
  const payload =
    rawPayload && typeof rawPayload === 'object'
      ? (rawPayload as Record<string, unknown>)
      : { value: rawPayload };

  const correlationId = norm.correlationId?.trim() || norm.eventID;
  const idempotencyKey = `${norm.tableName ?? 'table'}:${norm.eventID}`;

  return {
    eventId: norm.eventID,
    eventType: meta.eventType,
    eventVersion: meta.eventVersion,
    timestamp: isoTimestamp(norm),
    source: meta.source,
    idempotencyKey,
    payload,
    meta: {
      correlationId,
      traceId: norm.traceId,
      causationId: norm.causationId,
      retryCount: norm.retryCount,
      publishedAt: isoTimestamp(norm),
      attributes: {
        streamTransport: norm.transport,
        streamEventName: norm.eventName,
        streamTableName: norm.tableName,
        streamSequenceNumber: norm.sequenceNumber,
        streamStreamArn: norm.streamArn,
      },
    },
  };
}

/**
 * Factory for {@link EventConsumerDeps.mapRawToBaseEvent} that normalizes stream records,
 * routes to a schema, and builds a {@link BaseEvent} (no AttributeValue maps in payload).
 */
export function createDynamoStreamMapRawToBaseEvent(
  routes: DynamoStreamRoute[],
): (raw: unknown) => BaseEvent {
  return (raw: unknown) => {
    if (!isDynamoDbStreamRecord(raw)) {
      throw new EventValidationError('Expected aws:dynamodb stream record');
    }
    const norm = normalizeDynamoStreamRecord(raw);
    const route = routes.find((r) => matchDynamoStreamRoute(norm, r));
    if (!route) {
      throw new StreamRecordFilteredError();
    }
    return buildBaseEventFromNormalizedStream(norm, route.schema);
  };
}
