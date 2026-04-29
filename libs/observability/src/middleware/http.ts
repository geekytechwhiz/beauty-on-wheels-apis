import { randomUUID } from 'node:crypto';

import type { Handler } from 'aws-lambda';

import { withContext } from '../core/context';

/** API Gateway (REST or HTTP API) proxy-ish event shape. */
export type ApiGatewayLikeEvent = {
  headers?: Record<string, string | undefined> | null;
  requestContext?: { requestId?: string };
  multiValueHeaders?: Record<string, string[] | undefined> | null;
};

/**
 * Wrap an HTTP API Lambda handler: correlation id from headers or API Gateway request id, else new UUID.
 */
export function withHttpObservability<TEvent extends ApiGatewayLikeEvent, TResult>(
  handler: Handler<TEvent, TResult>
): Handler<TEvent, TResult> {
  return ((event, context, callback) => {
    const correlationId =
      correlationIdFromHttpEvent(event) ??
      (typeof event.requestContext?.requestId === 'string' && event.requestContext.requestId.length > 0
        ? event.requestContext.requestId
        : randomUUID());
    const awsRequestId = context.awsRequestId ?? 'unknown-request-id';
    return withContext({ correlationId, awsRequestId }, () =>
      handler(event, context, callback) as Promise<TResult> | TResult
    );
  }) as Handler<TEvent, TResult>;
}

function correlationIdFromHttpEvent(event: ApiGatewayLikeEvent): string | undefined {
  const headers = event.headers ?? undefined;
  if (headers) {
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-correlation-id' || lower === 'correlation-id') {
        const v = headers[key];
        if (typeof v === 'string' && v.length > 0) return v;
      }
    }
  }
  const multi = event.multiValueHeaders;
  if (multi) {
    for (const [key, vals] of Object.entries(multi)) {
      const lower = key.toLowerCase();
      if ((lower === 'x-correlation-id' || lower === 'correlation-id') && vals && vals[0]) {
        return vals[0];
      }
    }
  }
  return undefined;
}
