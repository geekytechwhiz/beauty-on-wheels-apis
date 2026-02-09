/**
 * Access audit payload — log every FHIR (or other) access for compliance.
 * Aligns with FHIR AuditEvent and common compliance requirements.
 */
export interface AccessAuditPayload {
  /** R = read, C = create, U = update, D = delete */
  action: 'R' | 'C' | 'U' | 'D';
  resourceType: string;
  resourceId?: string;
  /** Acting user/subject (e.g. from token sub). */
  agentId?: string;
  /** OAuth client id. */
  clientId?: string;
  /** Tenant/org for isolation. */
  tenantId?: string;
  /** 0 = success, 4 = minor failure, 8 = serious failure (FHIR outcome). */
  outcome: '0' | '4' | '8';
  /** When the access occurred (ISO string). */
  timestamp?: string;
  /** Optional request id for correlation. */
  requestId?: string;
}

export interface AccessAuditStorage {
  write(payload: AccessAuditPayload): Promise<void>;
}
