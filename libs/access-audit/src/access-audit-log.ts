/**
 * Access Audit Logging — log every FHIR access.
 * Storage is injectable; set via setAccessAuditStorage (e.g. in Lambda init or from audit-service).
 */

import type { AccessAuditPayload, AccessAuditStorage } from './types';

let storage: AccessAuditStorage | null = null;

const noopStorage: AccessAuditStorage = {
  async write(_payload: AccessAuditPayload): Promise<void> {
    return;
  },
};

/**
 * Sets the storage backend for access audit logs.
 * Call once at app/lambda init (e.g. with DynamoDB or Firehose implementation).
 */
export function setAccessAuditStorage(s: AccessAuditStorage | null): void {
  storage = s;
}

/**
 * Returns the current storage (for tests). Default is no-op.
 */
export function getAccessAuditStorage(): AccessAuditStorage {
  return storage ?? noopStorage;
}

/**
 * Logs an access event. Uses configured storage if set; otherwise no-op.
 * Non-blocking: do not await in hot path if storage is slow; fire-and-forget or queue in implementation.
 */
export async function logAccessAudit(payload: AccessAuditPayload): Promise<void> {
  const normalized: AccessAuditPayload = {
    ...payload,
    timestamp: payload.timestamp ?? new Date().toISOString(),
  };
  await getAccessAuditStorage().write(normalized);
}
