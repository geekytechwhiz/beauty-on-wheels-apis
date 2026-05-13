import { randomUUID } from 'node:crypto';

import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

/**
 * Extract correlation ID from API Gateway event (same rules as legacy `@api-hub/logger`).
 */
export function extractCorrelationId(
  event: APIGatewayProxyEvent | { headers?: Record<string, unknown> },
): string {
  if (event.headers) {
    const correlationId =
      event.headers['x-correlation-id'] ||
      event.headers['X-Correlation-Id'] ||
      event.headers['correlation-id'] ||
      event.headers['Correlation-Id'];

    if (correlationId && typeof correlationId === 'string') {
      return correlationId;
    }
  }

  if ('requestContext' in event && event.requestContext) {
    const requestId = (event.requestContext as { requestId?: string }).requestId;
    if (requestId) {
      return requestId;
    }
  }

  return `corr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * API Gateway / HTTP only: headers → requestContext.requestId → Lambda awsRequestId → UUID.
 * Returns `undefined` when the event is not API Gateway-shaped (SQS, EventBridge, etc.).
 */
export function resolveCorrelationIdForHttp(
  event:
    | APIGatewayProxyEvent
    | {
        headers?: Record<string, unknown>;
        requestContext?: unknown;
        httpMethod?: string;
        version?: string;
      }
    | null
    | undefined,
  lambdaAwsRequestId: string,
): string | undefined {
  if (!event || typeof event !== 'object') return undefined;

  const e = event as {
    requestContext?: unknown;
    httpMethod?: string;
    version?: string;
    headers?: Record<string, unknown>;
  };

  const isApiGw =
    e.requestContext != null ||
    typeof e.httpMethod === 'string' ||
    e.version === '2.0';

  if (!isApiGw) return undefined;

  if (e.headers) {
    const correlationId =
      e.headers['x-correlation-id'] ||
      e.headers['X-Correlation-Id'] ||
      e.headers['correlation-id'] ||
      e.headers['Correlation-Id'];
    if (
      correlationId &&
      typeof correlationId === 'string' &&
      correlationId.length > 0
    ) {
      return correlationId;
    }
  }

  if (e.requestContext) {
    const requestId = (e.requestContext as { requestId?: string }).requestId;
    if (requestId) return requestId;
  }

  if (lambdaAwsRequestId && lambdaAwsRequestId !== 'unknown-request-id') {
    return lambdaAwsRequestId;
  }

  return randomUUID();
}

export function extractAwsRequestId(context: Context): string {
  return context.awsRequestId || 'unknown-request-id';
}
