/** SQS-trigger shape: ApproximateReceiveCount is 1 on first delivery. */
export function approximateReceiveCount(raw: unknown): number | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;

  const attrs = (raw as { attributes?: Record<string, string> }).attributes;

  const rawCount = attrs?.ApproximateReceiveCount;
  if (rawCount === undefined) return undefined;
  const n = Number(rawCount);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A single ordinal for comparing against consumer `retry.maxAttempts` (also 1-based).
 */
export function computeEffectiveDeliveryAttempt(
  raw: unknown,
  metaRetryCount?: number,
): number {
  const sqs = approximateReceiveCount(raw);

  const fromEnvelope = Math.max(1, (metaRetryCount ?? 0) + 1);

  if (sqs !== undefined) return Math.max(sqs, fromEnvelope);

  return fromEnvelope;
}
