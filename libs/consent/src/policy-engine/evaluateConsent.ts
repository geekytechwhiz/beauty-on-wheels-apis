/**
 * Consent policy engine — evaluates access for a given patient, resource type, and purpose.
 * Policy-driven; no FHIR or app-specific imports.
 */

export type ConsentDecision = 'PERMIT' | 'DENY' | 'MASK';

export interface ConsentRequest {
  patientId: string;
  resourceType: string;
  purposeOfUse: string;
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
