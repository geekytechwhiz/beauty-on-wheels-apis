import { LambdaRequest } from '@api-hub/utils';

/**
 * API Gateway query values arrive on `params` after request middleware.
 * Tests and older callers also set `query` or `queryStringParameters`.
 * `params` wins when the same key is present in more than one place.
 */
export function requestQuery(request: LambdaRequest): Record<string, string | undefined> {
  const loose = request as LambdaRequest & {
    query?: Record<string, unknown> | null;
    queryStringParameters?: Record<string, unknown> | null;
  };
  const merged: Record<string, string | undefined> = {};
  for (const source of [loose.params, loose.query, loose.queryStringParameters]) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      if (merged[key] !== undefined) continue;
      if (typeof value === 'string') merged[key] = value;
    }
  }
  return merged;
}
