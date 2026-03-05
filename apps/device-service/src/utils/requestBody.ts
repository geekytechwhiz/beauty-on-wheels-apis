/**
 * Parses API Gateway event body (string or object) to a typed object.
 * @throws Error if body is a string and JSON.parse fails
 */
export function parseRequestBody(eventBody: string | null | undefined): unknown {
  if (eventBody == null) {
    return undefined;
  }
  if (typeof eventBody === 'string') {
    return JSON.parse(eventBody);
  }
  return eventBody;
}
