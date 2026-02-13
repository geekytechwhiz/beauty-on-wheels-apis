/**
 * Consent policy engine — evaluates access for a given patient, resource type, and purpose.
 * Policy-driven; no FHIR or app-specific imports.
 * Consent Enforcement Module: single entry point for validating patient/org consent.
 */

export type ConsentDecision = 'PERMIT' | 'DENY' | 'MASK';

export interface ConsentRequest {
  patientId: string;
  resourceType: string;
  purposeOfUse: string;
  /** Optional: acting user/subject for audit and policy. */
  agentId?: string;
  /** Optional: OAuth client for policy. */
  clientId?: string;
  /** Optional: tenant/org for org-level consent. */
  tenantId?: string;
}

/**
 * Evaluates consent for the given request.
 * Returns PERMIT, DENY, or MASK (e.g. for redaction).
 */
export function evaluateConsent(request: ConsentRequest): ConsentDecision {
  // Placeholder: integrate with real policy store (e.g. consent records, OAuth scopes).
  if (!request.patientId || !request.resourceType) {
    return 'DENY';
  }
  // Default safe: permit for same-subject reads when purpose is treatment.
  if (request.purposeOfUse === 'TREATMENT' || request.purposeOfUse === 'HPAYMT') {
    return 'PERMIT';
  }
  if (request.purposeOfUse === 'MASKED') {
    return 'MASK';
  }
  // Restrict unknown purposes by default.
  return 'DENY';
}

/**
 * Auth context shape used by enforceConsent (avoids coupling to a specific auth lib).
 */
export interface ConsentAuthContext {
  subjectId?: string;
  clientId?: string;
  purposeOfUse?: string;
  tenantId?: string;
}

/**
 * Consent Enforcement Module: validates patient/org consent using auth context.
 * Use this from FHIR handlers for consistent consent checks.
 */
export function enforceConsent(
  auth: ConsentAuthContext | null,
  patientId: string,
  resourceType: string
): ConsentDecision {
  const purposeOfUse = auth?.purposeOfUse ?? 'TREATMENT';
  return evaluateConsent({
    patientId,
    resourceType,
    purposeOfUse,
    agentId: auth?.subjectId,
    clientId: auth?.clientId,
    tenantId: auth?.tenantId,
  });
}
