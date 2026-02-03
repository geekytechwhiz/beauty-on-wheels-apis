/**
 * GET /fhir/Patient/{id}
 * Auth → Consent → Fetch canonical from apps → Map to FHIR → Validate → Response.
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAuthContext } from '../auth';
import { evaluateConsent } from '@api-hub/consent';
import { fetchCanonicalPatient } from './fetchCanonical';
import { exposePatient } from '../exposure';

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const id = event.pathParameters?.id;
  if (!id) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'required', details: { text: 'Patient id required' } }],
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
    patientId: id,
    resourceType: 'Patient',
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

  const canonical = await fetchCanonicalPatient(id);
  if (!canonical) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'not-found', details: { text: 'Patient not found' } }],
      }),
    };
  }

  if (consent === 'MASK') {
    // Placeholder: apply masking to canonical before mapping
  }

  const result = exposePatient(canonical, 'r4');
  if (!result.success) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify(result.outcome),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/fhir+json' },
    body: JSON.stringify(result.resource),
  };
}
