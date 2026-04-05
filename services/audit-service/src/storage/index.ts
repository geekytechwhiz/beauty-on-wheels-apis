/**
 * Stub storage interface for audit and provenance events.
 */
export interface AuditStorage {
  write(event: unknown): Promise<void>;
  query(criteria: unknown): Promise<unknown[]>;
}

export function createAuditStorage(): AuditStorage {
  return {
    async write(_event: unknown): Promise<void> {
      return;
    },
    async query(_criteria: unknown) {
      return [];
    },
  };
}
