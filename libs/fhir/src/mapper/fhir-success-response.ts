import type { APIGatewayProxyResult } from 'aws-lambda';

/**
 * Returns a raw FHIR resource or Bundle as the HTTP response body.
 */
export function fhirSuccessResponse(body: unknown): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/fhir+json',
    },
    body: JSON.stringify(body),
  };
}
