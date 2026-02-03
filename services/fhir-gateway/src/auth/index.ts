/**
 * Auth handler — OAuth2 / SMART on FHIR stub.
 * Validates token and returns client/subject context for consent and capability.
 */
export interface AuthContext {
  clientId: string;
  subjectId?: string;
  scope?: string[];
  purposeOfUse?: string;
}

/**
 * Stub: extract or validate token and return auth context.
 * Replace with real OAuth2/SMART token introspection.
 */
export function getAuthContext(
  _authorizationHeader?: string,
  _requestContext?: unknown
): AuthContext | null {
  // Placeholder: parse Bearer token, introspect, map to clientId/subjectId/scopes.
  return {
    clientId: 'default-client',
    purposeOfUse: 'TREATMENT',
  };
}
