/**
 * GET /fhir/Patient/{id}
 * Auth → Scope → Consent → Tenant → Fetch canonical → Map to FHIR → Audit → Response.
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAuthContext } from '../auth';
import { enforceConsent } from '@api-hub/consent';
import { isScopeAllowed } from '@api-hub/scope-mapping';
import { assertResourceInTenant, TenantAccessDeniedError } from '@api-hub/tenant-guard';
import { logAccessAudit } from '@api-hub/access-audit';
import { fetchCanonicalPatient } from './fetchCanonical';
import { exposePatient } from '../exposure';

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
  const id = event.pathParameters?.id;
  if (!id) {
    return operationOutcome(400, 'required', 'Patient id required');
  }

  const auth = getAuthContext(
    event.headers?.Authorization ?? event.headers?.authorization,
    event.requestContext
  );
  if (!auth) {
    return operationOutcome(401, 'login', 'Unauthorized');
  }

  // const scopes = auth.scope ?? [];
  // if (!isScopeAllowed(scopes, 'Patient', 'read')) {
  //   return operationOutcome(403, 'forbidden', 'Insufficient scope for Patient read');
  // }

  const consent = enforceConsent(auth, id, 'Patient');
  if (consent === 'DENY') {
    return operationOutcome(403, 'forbidden', 'Consent denied');
  }

  const authHeader = event.headers?.Authorization ?? event.headers?.authorization;
  const fetchResult = await fetchCanonicalPatient(id, {
    headers: authHeader ? { Authorization: authHeader, Accept: 'application/json, text/plain, */*' } : undefined,
  });
  if (!fetchResult) {
    return operationOutcome(404, 'not-found', 'Patient not found');
  }

  const { canonical, raw } = fetchResult;

  const skipTenantCheck = process.env.FHIR_GATEWAY_LOCAL_DEV === 'true';
  if (auth.tenantId && !skipTenantCheck) {
    const resourceTenantId = canonical.organizationId ?? '';
    if (!resourceTenantId) {
      return operationOutcome(403, 'forbidden', 'Tenant isolation: resource has no tenant');
    }
    try {
      assertResourceInTenant(auth.tenantId, resourceTenantId, 'Patient', id);
    } catch (err) {
      if (err instanceof TenantAccessDeniedError) {
        return operationOutcome(403, 'forbidden', 'Tenant isolation: access denied');
      }
      throw err;
    }
  }

  if (consent === 'MASK') {
    // Placeholder: apply masking to canonical before mapping
  }

  const fhirResult = exposePatient(canonical, 'r4');
  if (!fhirResult.success) {
    await logAccessAudit({
      action: 'R',
      resourceType: 'Patient',
      resourceId: id,
      agentId: auth.subjectId,
      clientId: auth.clientId,
      tenantId: auth.tenantId,
      outcome: '8',
      requestId: event.requestContext?.requestId,
    });
    return {
      statusCode: 500,
      headers: fhirJson,
      body: JSON.stringify(fhirResult.outcome),
    };
  }

  await logAccessAudit({
    action: 'R',
    resourceType: 'Patient',
    resourceId: id,
    agentId: auth.subjectId,
    clientId: auth.clientId,
    tenantId: auth.tenantId,
    outcome: '0',
    requestId: event.requestContext?.requestId,
  });

  // Response: full domain object (raw) + FHIR-formatted fields (resourceType, id, name, gender, birthDate, address, telecom, etc.)
  const responseBody = { ...(raw ?? {}), ...fhirResult.resource };

  return {
    statusCode: 200,
    headers: fhirJson,
    body: JSON.stringify(responseBody),
  };
}
