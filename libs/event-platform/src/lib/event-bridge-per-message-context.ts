/**
 * Resolves correlation id from EventBridge `detail.meta.correlationId` or legacy `detail.correlationId`.
 */
export function correlationHintFromEventBridge(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== 'object') {
    return undefined;
  }
  const detail = (raw as { detail?: { meta?: { correlationId?: string }; correlationId?: string } })
    .detail;
  if (!detail || typeof detail !== 'object') {
    return undefined;
  }
  const fromMeta = detail.meta?.correlationId;
  if (typeof fromMeta === 'string' && fromMeta.trim().length > 0) {
    return fromMeta.trim();
  }
  const legacy = detail.correlationId;
  if (typeof legacy === 'string' && legacy.trim().length > 0) {
    return legacy.trim();
  }
  return undefined;
}

/**
 * AsyncLocalStorage / logger context fields for one EventBridge invocation.
 */
export function buildEventBridgePerMessageLoggerContext(input: {
  rawRecord: unknown;
  operation: string;
  lambdaAwsRequestId?: string;
}): Record<string, string | undefined> {
  const raw = input.rawRecord;
  let eventId: string | undefined;
  let eventType: string | undefined;
  let traceId: string | undefined;

  if (raw !== null && typeof raw === 'object') {
    const detail = (raw as { detail?: Record<string, unknown> }).detail;
    if (detail && typeof detail === 'object') {
      if (typeof detail.eventId === 'string') {
        eventId = detail.eventId;
      }
      if (typeof detail.eventType === 'string') {
        eventType = detail.eventType;
      }
      const meta = detail.meta as { traceId?: string } | undefined;
      if (typeof meta?.traceId === 'string') {
        traceId = meta.traceId;
      }
    }
    if (!eventType && typeof (raw as { 'detail-type'?: string })['detail-type'] === 'string') {
      eventType = (raw as { 'detail-type': string })['detail-type'];
    }
  }

  const correlation =
    correlationHintFromEventBridge(raw) ?? eventId ?? input.lambdaAwsRequestId ?? 'unknown';

  return {
    correlationId: correlation,
    awsRequestId: input.lambdaAwsRequestId,
    operation: input.operation,
    ...(eventId ? { eventId } : {}),
    ...(eventType ? { eventType } : {}),
    ...(traceId ? { traceId } : {}),
  };
}
