import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { resolveSchema as resolveSchemaFromCore } from '../core/schema/schema-resolver';

import type { BaseEvent } from '../typings/base-event.types';

import type { VersionedPayloadSchemas } from '../typings/consumer.types';

/** Prefer `core/schema/schema-resolver` for new code. */
export function resolveSchema(
  schemas: VersionedPayloadSchemas | undefined,
  eventType: string,
  version: string,
): z.ZodType<unknown> {
  return resolveSchemaFromCore(
    schemas as Record<string, Record<string, z.ZodType<unknown>>> | undefined,
    eventType,
    version,
  ) as z.ZodType<unknown>;
}

export function buildInternalMapper(
  schemaMap: Record<string, Record<string, z.ZodType<unknown>>>,
  source: string,
) {
  return (raw: {
    id: string;
    time: string;
    source?: string;
    correlationId?: string;
    ['detail-type']: string;
    detail?: {
      version?: string;
      idempotencyKey?: string;
      correlationId?: string;
      meta?: { correlationId?: string; retryCount?: number };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }): BaseEvent<unknown> => {
    const eventType = raw['detail-type'];
    const detail = raw.detail || {};

    const version = typeof detail.version === 'string' ? detail.version : 'v1';

    const schema = schemaMap[eventType]?.[version];

    if (!schema) {
      throw new Error(`Schema not found for ${eventType} version ${version}`);
    }

    const payload = schema.parse(detail);

    const correlationId =
      detail.meta?.correlationId ||
      detail.correlationId ||
      raw.correlationId ||
      raw.id;

    return {
      eventId: raw.id,
      eventType,
      eventVersion: version,
      timestamp: raw.time,
      source,

      idempotencyKey: detail.idempotencyKey || raw.id,

      payload,

      meta: {
        correlationId,
        retryCount: detail.meta?.retryCount ?? 0,
        publishedAt: raw.time,
      },
    };
  };
}

export function generateEventId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
