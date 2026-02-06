/**
 * Connection metadata for delivery (not domain data).
 */
export interface ConnectionContext {
  connectionId: string;
  userId: string;
  orgId: string;
  roles: string[];
  connectedAt: string;
  ttl: number;
}
