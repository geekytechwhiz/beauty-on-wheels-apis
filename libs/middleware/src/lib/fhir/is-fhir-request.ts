import type { LambdaRequest } from '@api-hub/utils';

const FHIR_MEDIA_TYPE = 'application/fhir+json';

function getHeader(
  req: LambdaRequest,
  name: string,
): string | undefined {
  const headers = req.event?.headers;
  if (!headers) {
    return undefined;
  }

  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName && typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function acceptsFhirMediaType(acceptHeader: string | undefined): boolean {
  if (!acceptHeader) {
    return false;
  }

  return acceptHeader
    .split(',')
    .some((part) => part.trim().split(';')[0].trim() === FHIR_MEDIA_TYPE);
}

function hasFhirFormatQuery(req: LambdaRequest): boolean {
  const format =
    req.query?._format ??
    req.query?.format ??
    req.params?._format ??
    req.params?.format ??
    req.event?.queryStringParameters?._format ??
    req.event?.queryStringParameters?.format;

  if (typeof format !== 'string') {
    return false;
  }

  const normalized = format.toLowerCase();
  return (
    normalized === FHIR_MEDIA_TYPE ||
    normalized === 'fhir' ||
    normalized === 'json'
  );
}

/**
 * Detects whether the caller expects a FHIR response (content negotiation).
 */
export function isFhirRequest(req: LambdaRequest): boolean {
  const contentType = getHeader(req, 'Content-Type');
  if (contentType?.split(';')[0].trim() === FHIR_MEDIA_TYPE) {
    return true;
  }

  if (acceptsFhirMediaType(getHeader(req, 'Accept'))) {
    return true;
  }

  if (
    getHeader(req, 'x-fhir-request')?.toLowerCase() === 'true' ||
    getHeader(req, 'x-fhir-response')?.toLowerCase() === 'true'
  ) {
    return true;
  }

  const path = req.event?.path ?? req.event?.resource ?? '';
  if (typeof path === 'string' && path.includes('/fhir')) {
    return true;
  }

  return hasFhirFormatQuery(req);
}
