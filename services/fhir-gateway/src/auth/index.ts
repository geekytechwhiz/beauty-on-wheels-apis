/**
 * Auth context for FHIR gateway — from API Gateway authorizer or stub.
 * Supports OAuth2 / SMART on FHIR (scopes, tenantId, clientId from requestContext.authorizer).
 */
export interface AuthContext {
  clientId: string;
  subjectId?: string;
  scope?: string[];
  purposeOfUse?: string;
  tenantId?: string;
}

/** Authorizer context shape set by Lambda authorizer (values are strings). */
interface AuthorizerContext {
  sub?: string;
  clientId?: string;
  scopes?: string;
  tenantId?: string;
  patient?: string;
  fhirUser?: string;
  encounter?: string;
}

function parseScopes(scopesJson: string | undefined): string[] {
  if (scopesJson == null || scopesJson === '') return [];
  try {
    const parsed = JSON.parse(scopesJson) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Builds auth context from API Gateway event.
 * When the request went through the Lambda authorizer, reads sub, clientId, scopes, tenantId from requestContext.authorizer.
 * Otherwise falls back to stub for local/dev.
 */
export function getAuthContext(
  authorizationHeader?: string,
  requestContext?: unknown
): AuthContext | null {
  const ctx = requestContext as { authorizer?: AuthorizerContext | null } | null | undefined;
  const authorizer = ctx?.authorizer ?? undefined;
  if (authorizer) {
    const scopes = parseScopes(authorizer.scopes);
    return {
      clientId: authorizer.clientId ?? '',
      subjectId: authorizer.sub,
      scope: scopes.length > 0 ? scopes : undefined,
      purposeOfUse: 'TREATMENT',
      tenantId: authorizer.tenantId,
    };
  }
  if (authorizationHeader?.startsWith('Bearer ')) {
    const isLocalDev = process.env.FHIR_GATEWAY_LOCAL_DEV === 'true';
    return {
      clientId: 'default-client',
      purposeOfUse: 'TREATMENT',
      ...(isLocalDev && {
        scope: ['patient/Patient.read', 'user/Observation.read', 'user/Observation.search'],
        tenantId: 'local-tenant',
      }),
    };
  }
  return null;
}
