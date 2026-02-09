/**
 * Canonical integration result (partner-agnostic).
 * No raw partner payloads or partner-specific fields.
 */

export type OrderStatus =
  | 'PENDING'
  | 'COLLECTED'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'UNKNOWN';

export interface IntegrationResult {
  success: boolean;
  orderId?: string;
  status?: OrderStatus;
  message?: string;
  externalOrderId?: string;
  errors?: Array<{ code?: string; message: string }>;
}
