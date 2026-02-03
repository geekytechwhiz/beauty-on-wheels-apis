/**
 * GET /fhir/metadata — CapabilityStatement for the requesting client.
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAuthContext } from '../auth';
import { getClientCapability } from '@api-hub/capability';

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const auth = getAuthContext(
    event.headers?.Authorization ?? event.headers?.authorization
  );
  const clientId = auth?.clientId ?? 'anonymous';
  const statement = getClientCapability(clientId);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/fhir+json' },
    body: JSON.stringify(statement),
  };
}
