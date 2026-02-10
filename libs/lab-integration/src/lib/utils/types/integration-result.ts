/**
 * Standard result type for all partner integrations.
 */
export interface IntegrationResult {
  success: boolean;
  orderId?: string;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Helper to create success result.
 */
export function toResult(
  data: unknown,
  metadata?: Record<string, unknown>
): IntegrationResult {
  return {
    success: true,
    data,
    metadata,
  };
}

/**
 * Helper to create error result.
 */
export function toResultError(
  orderId: string,
  error: string
): IntegrationResult {
  return {
    success: false,
    orderId,
    error,
  };
}
