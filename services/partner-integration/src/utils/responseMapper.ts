import type { IntegrationResult, OrderStatus } from '../models/integration.result';

const STATUS_MAP: Record<string, OrderStatus> = {
  pending: 'PENDING',
  submitted: 'PENDING',
  pending_collection: 'PENDING',
  collected: 'COLLECTED',
  in_transit: 'IN_TRANSIT',
  received: 'RECEIVED',
  in_progress: 'IN_PROGRESS',
  processing: 'IN_PROGRESS',
  completed: 'COMPLETED',
  complete: 'COMPLETED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  failed: 'FAILED',
  error: 'FAILED',
  rejected: 'FAILED',
};

function normalizeStatus(raw: unknown): OrderStatus {
  if (raw == null) return 'UNKNOWN';
  const s = String(raw).toLowerCase().trim();
  return STATUS_MAP[s] ?? 'UNKNOWN';
}

/**
 * Generic partner response shape (orderId/id, status/state, externalId).
 * Adapters map partner-specific payloads to this before calling toResult.
 */
export interface PartnerOrderPayload {
  orderId?: string;
  id?: string;
  status?: unknown;
  state?: unknown;
  externalOrderId?: string;
  externalId?: string;
  message?: string;
  error?: string;
  errors?: Array<{ code?: string; message?: string }>;
}

export function toResult(
  payload: PartnerOrderPayload | null,
  options: { orderId?: string; success?: boolean } = {}
): IntegrationResult {
  const success = payload !== null && (options.success ?? true);
  const orderId = payload?.orderId ?? payload?.id ?? options.orderId;
  const status = normalizeStatus(payload?.status ?? payload?.state);
  const externalOrderId = payload?.externalOrderId ?? payload?.externalId;
  const message = payload?.message ?? payload?.error;
  const errors = payload?.errors?.map((e) => ({ code: e.code, message: e.message ?? '' }));

  return {
    success,
    ...(orderId && { orderId }),
    ...(status && { status }),
    ...(message && { message }),
    ...(externalOrderId && { externalOrderId }),
    ...(errors && errors.length > 0 && { errors }),
  };
}

export function toResultError(orderId: string, message: string): IntegrationResult {
  return {
    success: false,
    orderId,
    status: 'FAILED',
    message,
    errors: [{ message }],
  };
}
