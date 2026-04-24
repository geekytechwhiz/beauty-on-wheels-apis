import { extractAwsRequestId, extractCorrelationId } from '@api-hub/logger';
import type { Context } from 'aws-lambda';

import type { ExecutionContext, MiddlewarePipelineEvent } from './types';

const awsRequestIdFromLambdaContext = (lambdaContext: unknown): string =>
  extractAwsRequestId(lambdaContext as Context);

/**
 * SQS: message attributes, body JSON, or `messageId` (prefixed) as a stable id.
 */
function correlationIdFromSqsEvent(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) {
    return undefined;
  }
  const recs = (event as { Records?: unknown }).Records;
  if (!Array.isArray(recs) || recs.length === 0) {
    return undefined;
  }
  const rec = recs[0] as Record<string, unknown>;
  const attrs = rec.messageAttributes as
    | Record<string, { stringValue?: string }>
    | undefined;
  if (attrs) {
    const fromAttr =
      attrs.correlationId?.stringValue ||
      attrs.CorrelationId?.stringValue ||
      attrs['X-Correlation-Id']?.stringValue;
    if (typeof fromAttr === 'string' && fromAttr.length > 0) {
      return fromAttr;
    }
  }
  if (typeof rec.body === 'string' && rec.body.length > 0) {
    try {
      const body = JSON.parse(rec.body) as {
        correlationId?: string;
        metadata?: { correlationId?: string };
      };
      if (typeof body.correlationId === 'string' && body.correlationId.length > 0) {
        return body.correlationId;
      }
      const m = body.metadata?.correlationId;
      if (typeof m === 'string' && m.length > 0) {
        return m;
      }
    } catch {
      /* not JSON */
    }
  }
  if (typeof rec.messageId === 'string' && rec.messageId.length > 0) {
    return `sqs:${rec.messageId}`;
  }
  return undefined;
}

/**
 * EventBridge: envelope `id`, or `detail.correlationId` / `detail.metadata`.
 */
function correlationIdFromEventBridgeLike(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) {
    return undefined;
  }
  const e = event as Record<string, unknown>;
  if (typeof e.id === 'string' && e.id.length > 0) {
    if (typeof e.source === 'string' || e['detail-type'] != null) {
      return e.id;
    }
  }
  const detail = e.detail;
  if (detail && typeof detail === 'object' && detail !== null) {
    const d = detail as Record<string, unknown>;
    if (typeof d.correlationId === 'string' && d.correlationId.length > 0) {
      return d.correlationId;
    }
    const meta = d.metadata;
    if (meta && typeof meta === 'object' && meta !== null) {
      const c = (meta as { correlationId?: string }).correlationId;
      if (typeof c === 'string' && c.length > 0) {
        return c;
      }
    }
  }
  return undefined;
}

/**
 * Resolves a correlation id: SQS and EventBridge first, then API Gateway / HTTP (shared logger helper),
 * which may generate a fallback string when absent.
 */
export function resolveCorrelationId(event: unknown): string {
  return (
    correlationIdFromSqsEvent(event) ??
    correlationIdFromEventBridgeLike(event) ??
    extractCorrelationId(
      event as Parameters<typeof extractCorrelationId>[0]
    )
  );
}

/**
 * `source` and `eventType` hints by transport (EventBridge, SQS, API Gateway / HTTP).
 */
function transportSourceAndType(event: unknown): Pick<
  ExecutionContext,
  'source' | 'eventType'
> {
  if (typeof event !== 'object' || event === null) {
    return {};
  }
  const e = event as Record<string, unknown>;

  if (typeof e.source === 'string') {
    if (e['detail-type'] != null || e.detail != null) {
      return {
        source: e.source,
        eventType:
          typeof e['detail-type'] === 'string' ? e['detail-type'] : undefined,
      };
    }
    if (typeof e.type === 'string') {
      return { source: e.source, eventType: e.type };
    }
  }

  const records = e.Records;
  if (Array.isArray(records) && records.length > 0) {
    const r0 = records[0] as {
      eventSource?: string;
      eventSourceARN?: string;
    };
    return {
      source: r0.eventSource ?? r0.eventSourceARN,
      eventType: 'aws:sqs',
    };
  }

  if (e.requestContext != null) {
    if (typeof e.httpMethod === 'string') {
      const path = typeof e.path === 'string' ? e.path : '';
      return {
        source: 'aws:apigateway',
        eventType: path ? `${e.httpMethod} ${path}` : e.httpMethod,
      };
    }
    const v2 = e as { version?: string; rawPath?: string; requestContext?: { http?: { method?: string } } };
    if (v2.version === '2.0' && v2.requestContext?.http?.method) {
      const p = v2.rawPath ?? '';
      return {
        source: 'aws:apigateway',
        eventType: p ? `${v2.requestContext.http.method} ${p}` : v2.requestContext.http.method,
      };
    }
  }

  if (typeof e.type === 'string' && e.source == null) {
    return { eventType: e.type };
  }

  return {};
}

/**
 * Builds standard {@link ExecutionContext} fields from the Lambda `event` and `context`.
 * Does not read or write `event.__context`; callers attach the result.
 */
export function buildStandardEventContext(
  event: unknown,
  lambdaContext: unknown
): Pick<
  ExecutionContext,
  'correlationId' | 'awsRequestId' | 'source' | 'eventType'
> {
  const { source, eventType } = transportSourceAndType(event);

  return {
    correlationId: resolveCorrelationId(event),
    awsRequestId: awsRequestIdFromLambdaContext(lambdaContext),
    source,
    eventType,
  };
}

/**
 * Merges standardized context into `event.__context` only. Does not set
 * `correlationId` / `awsRequestId` / `source` / `eventType` on the event root
 * (avoids polluting wire payloads).
 */
export function applyStandardEventContext(
  event: MiddlewarePipelineEvent,
  lambdaContext: unknown
): void {
  const prior = event.__context ?? {};
  const built = buildStandardEventContext(event, lambdaContext);
  event.__context = { ...prior, ...built };
}
