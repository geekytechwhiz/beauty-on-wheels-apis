import { randomUUID } from 'node:crypto';

import type { Handler } from 'aws-lambda';

import { withLoggerContext } from '../core/context.js';

/**
 * Wrap a Lambda handler to bind `correlationId` (propagated from the event when present, else new UUID)
 * and `awsRequestId` into observability AsyncLocalStorage.
 */
export function withLambdaObservability<TEvent, TResult>(
  handler: Handler<TEvent, TResult>
): Handler<TEvent, TResult> {
  return ((event, context, callback) => {
    const correlationId = extractCorrelationIdFromLambdaEvent(event) ?? randomUUID();
    const awsRequestId = context.awsRequestId ?? 'unknown-request-id';
    return withLoggerContext({ correlationId, awsRequestId }, () =>
      handler(event, context, callback) as Promise<TResult> | TResult
    );
  }) as Handler<TEvent, TResult>;
}

function extractCorrelationIdFromLambdaEvent(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined;

  const e = event as Record<string, unknown>;

  const headers = e.headers;
  if (headers && typeof headers === 'object') {
    const h = headers as Record<string, unknown>;
    const fromHeaders = readHeader(h, 'x-correlation-id', 'X-Correlation-Id', 'correlation-id', 'Correlation-Id');
    if (fromHeaders) return fromHeaders;
  }

  const requestContext = e.requestContext;
  if (requestContext && typeof requestContext === 'object') {
    const rc = requestContext as { requestId?: string };
    if (typeof rc.requestId === 'string' && rc.requestId.length > 0) {
      return rc.requestId;
    }
  }

  const meta = e.meta;
  if (meta && typeof meta === 'object') {
    const m = meta as { correlationId?: string };
    if (typeof m.correlationId === 'string' && m.correlationId.length > 0) {
      return m.correlationId;
    }
  }

  return undefined;
}

function readHeader(headers: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const v = headers[name];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}
