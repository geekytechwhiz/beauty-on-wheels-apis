/**
 * Shared types for Lambda Authorizer (OAuth2 / SMART on FHIR).
 * Used to inject validated claims into requestContext.authorizer.
 */

/** SMART on FHIR context tokens (when present in JWT). */
export interface SmartContext {
  /** Patient context (e.g. Patient/123). */
  patient?: string;
  /** FHIR user (e.g. Practitioner/456). */
  fhirUser?: string;
  /** Encounter context when in scope. */
  encounter?: string;
}

/** Authorizer context injected into API Gateway requestContext.authorizer. */
export interface AuthorizerContext {
  /** Subject (user or client identifier). */
  sub: string;
  /** OAuth2 client_id. */
  clientId: string;
  /** Parsed scope list (e.g. patient/*.read, user/*.read). */
  scopes: string[];
  /** Tenant identifier (from custom:tenant_id or legacy custom:organizationID). */
  tenantId: string;
  /** SMART context when present. */
  patient?: string;
  fhirUser?: string;
  encounter?: string;
  /** Legacy: custom:userID (for user-details fetch and context). */
  userID?: string;
  /** Legacy: custom:organizationID (for user-details and tenant). */
  organizationID?: string;
  /** Legacy: token auth_time for tokenUpdatedAt check. */
  authTime?: number;
}

/** JWT payload shape after verification (Cognito / OAuth2). */
export interface VerifiedPayload {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  token_use?: string;
  scope?: string;
  client_id?: string;
  [key: string]: unknown;
}
