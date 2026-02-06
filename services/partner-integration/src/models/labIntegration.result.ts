/**
 * Canonical lab integration result (partner-agnostic).
 * No raw partner payloads or partner-specific fields.
 */

export type LabOrderStatus =
  | 'PENDING'
  | 'COLLECTED'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'UNKNOWN';

export interface LabIntegrationResult {
  success: boolean;
  orderId?: string;
  status?: LabOrderStatus;
  message?: string;
  externalOrderId?: string;
  errors?: Array<{ code?: string; message: string }>;
}
