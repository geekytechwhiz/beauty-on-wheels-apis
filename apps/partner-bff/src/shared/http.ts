import { LambdaRequest } from '@api-hub/utils';

/** Query values are supplied by API Gateway; headers are deliberately excluded. */
export function queryOf(request: LambdaRequest): Record<string, string | undefined> {
  const event = request.event as unknown as {
    queryStringParameters?: Record<string, unknown> | null;
  };
  const values: Record<string, string | undefined> = {};
  for (const source of [request.params, request.query, event.queryStringParameters]) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      if (values[key] === undefined && typeof value === 'string') values[key] = value;
    }
  }
  return values;
}

export function header(request: LambdaRequest, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(request.event?.headers ?? {})) {
    if (key.toLowerCase() === target && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}
