import type { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from "aws-lambda";
 
function normalizeHeaders(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): Record<string, string> {

  const headers: Record<string, string> = {};

  if ("headers" in event && event.headers) {
    for (const [key, value] of Object.entries(event.headers)) {
      if (value) headers[key.toLowerCase()] = value;
    }
  }

  if ("multiValueHeaders" in event && event.multiValueHeaders) {
    for (const [key, values] of Object.entries(event.multiValueHeaders)) {
      if (values?.length) headers[key.toLowerCase()] = values[0];
    }
  }

  return headers;
}
export function extractLanguageFromEvent(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): string | null {

  const headers = normalizeHeaders(event);

  return (
    headers["x-language"] ||
    headers["accept-language"] ||
    null
  );
}

export function extractHeader(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
  headerName: string
): string | null {

  const headers = normalizeHeaders(event);

  return headers[headerName.toLowerCase()] || null;
}

export function extractHeaders(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
  headerNames: string[]
): Record<string, string | null> {

  const headers = normalizeHeaders(event);

  const result: Record<string, string | null> = {};

  for (const name of headerNames) {
    result[name] = headers[name.toLowerCase()] || null;
  }

  return result;
}
export function extractAuthToken(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): string | null {

  const headers = normalizeHeaders(event);

  const auth = headers["authorization"];

  if (!auth) return null;

  return auth.replace(/^Bearer\s+/i, "").trim();
}
export function extractCorrelationId(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): string | null {

  const headers = normalizeHeaders(event);

  return (
    headers["x-correlation-id"] ||
    headers["correlation-id"] ||
    null
  );
}
