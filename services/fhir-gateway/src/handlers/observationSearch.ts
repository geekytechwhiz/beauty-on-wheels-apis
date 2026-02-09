/**
 * GET /fhir/Observation?patient={id}
 * Auth → Scope → Consent → Tenant (via patient) → Fetch canonical → Map to FHIR → Audit → Response.
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAuthContext } from '../auth';
import { enforceConsent } from '@api-hub/consent';
import { isScopeAllowed } from '@api-hub/scope-mapping';
import { assertResourceInTenant, TenantAccessDeniedError } from '@api-hub/tenant-guard';
import { logAccessAudit } from '@api-hub/access-audit';
import { fetchCanonicalPatient, fetchCanonicalObservations } from './fetchCanonical';
import { exposeObservation } from '../exposure';

const fhirJson = { 'Content-Type': 'application/fhir+json' };

function operationOutcome(statusCode: number, code: string, text: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: fhirJson,
    body: JSON.stringify({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code, details: { text } }],
    }),
  };
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const patientId = event.queryStringParameters?.patient;
  if (!patientId) {
    return operationOutcome(400, 'required', 'Query parameter patient is required');
  }

  const auth = getAuthContext(
    event.headers?.Authorization ?? event.headers?.authorization,
    event.requestContext
  );
  if (!auth) {
    return operationOutcome(401, 'login', 'Unauthorized');
  }

  const scopes = auth.scope ?? [];
  if (!isScopeAllowed(scopes, 'Observation', 'search')) {
    return operationOutcome(403, 'forbidden', 'Insufficient scope for Observation search');
  }

  const consent = enforceConsent(auth, patientId, 'Observation');
  if (consent === 'DENY') {
    return operationOutcome(403, 'forbidden', 'Consent denied');
  }

  if (auth.tenantId) {
    const patient = await fetchCanonicalPatient(patientId);
    const resourceTenantId = patient?.organizationId ?? '';
    if (!resourceTenantId) {
      return operationOutcome(403, 'forbidden', 'Tenant isolation: patient has no tenant');
    }
    try {
      assertResourceInTenant(auth.tenantId, resourceTenantId, 'Observation', patientId);
    } catch (err) {
      if (err instanceof TenantAccessDeniedError) {
        return operationOutcome(403, 'forbidden', 'Tenant isolation: access denied');
      }
      throw err;
    }
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

  await logAccessAudit({
    action: 'R',
    resourceType: 'Observation',
    resourceId: patientId,
    agentId: auth.subjectId,
    clientId: auth.clientId,
    tenantId: auth.tenantId,
    outcome: '0',
    requestId: event.requestContext?.requestId,
  });

  return {
    statusCode: 200,
    headers: fhirJson,
    body: JSON.stringify(bundle),
  };
}
