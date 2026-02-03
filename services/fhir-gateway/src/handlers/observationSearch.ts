/**
 * GET /fhir/Observation?patient={id}
 * Auth → Consent → Fetch canonical from apps → Map to FHIR Bundle → Validate → Response.
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAuthContext } from '../auth';
import { evaluateConsent } from '@api-hub/consent';
import { fetchCanonicalObservations } from './fetchCanonical';
import { exposeObservation } from '../exposure';

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const patientId = event.queryStringParameters?.patient;
  if (!patientId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify({
        resourceType: 'OperationOutcome',
        issue: [
          {
            severity: 'error',
            code: 'required',
            details: { text: 'Query parameter patient is required' },
          },
        ],
      }),
    };
  }

  const auth = getAuthContext(
    event.headers?.Authorization ?? event.headers?.authorization
  );
  if (!auth) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'login', details: { text: 'Unauthorized' } }],
      }),
    };
  }

  const consent = evaluateConsent({
    patientId,
    resourceType: 'Observation',
    purposeOfUse: auth.purposeOfUse ?? 'TREATMENT',
  });
  if (consent === 'DENY') {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'forbidden', details: { text: 'Consent denied' } }],
      }),
    };
  }

  const canonicalList = await fetchCanonicalObservations(patientId);
  const entries: Array<{ fullUrl: string; resource: unknown }> = [];
  for (const canonical of canonicalList) {
    const result = exposeObservation(canonical, 'r4');
    if (result.success) {
      entries.push({
        fullUrl: `Observation/${result.resource.id ?? canonical.id}`,
        resource: result.resource,
      });
    }
  }

  const bundle = {
    resourceType: 'Bundle',
    type: 'searchset',
    total: entries.length,
    entry: entries,
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/fhir+json' },
    body: JSON.stringify(bundle),
  };
}
