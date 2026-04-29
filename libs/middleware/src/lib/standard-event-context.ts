import type { Context } from 'aws-lambda';

import type { ExecutionContext, MiddlewarePipelineEvent } from './types';
import { randomUUID } from 'node:crypto';

const awsRequestIdFromLambdaContext = (lambdaContext: unknown): string =>
  (lambdaContext as Context).awsRequestId || 'unknown-request-id';

/**
 * SQS: message attributes, body JSON, or `messageId` (prefixed) as a stable id.
 */
export function correlationIdFromSqsEvent(event: any): string | undefined {
  try {
    const record = event?.Records?.[0];
    if (!record) return;

    // Case 1: messageAttributes
    const attr = record.messageAttributes?.correlationId?.stringValue;
    if (attr) return attr;

    // Case 2: inside body (SNS → SQS)
    const body = JSON.parse(record.body);
    const message = body?.Message ? JSON.parse(body.Message) : body;

    return message?.meta?.correlationId;
  } catch {
    return undefined;
  }
}

 
export function extractCorrelationId(event: any): string | undefined {
  return event?.headers?.['x-correlation-id'];
}
export function correlationIdFromEventBridge(event: any): string | undefined {
  return event?.detail?.meta?.correlationId;
}
/**
 * Resolves a correlation id: SQS and EventBridge first, then API Gateway / HTTP (shared logger helper),
 * which may generate a fallback string when absent.
 */
export function resolveCorrelationId(event: any): string {
  return (
    correlationIdFromSqsEvent(event) ||
    correlationIdFromEventBridge(event) ||
    extractCorrelationId(event) ||
    randomUUID() // ✅ only as LAST fallback
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
  'correlationId' | 'awsRequestId' | 'source' | 'eventType' | 'traceId'
> {
  const { source, eventType } = transportSourceAndType(event);
  const traceFromEnv = process.env._X_AMZN_TRACE_ID;
  const traceId =
    typeof traceFromEnv === 'string' && traceFromEnv.length > 0
      ? traceFromEnv
      : undefined;

  return {
    correlationId: resolveCorrelationId(event),
    awsRequestId: awsRequestIdFromLambdaContext(lambdaContext),
    source,
    eventType,
    
    traceId,
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
