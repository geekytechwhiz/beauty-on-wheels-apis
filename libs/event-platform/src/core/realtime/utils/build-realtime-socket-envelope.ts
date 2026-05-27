import { getLoggerContext } from '@api-hub/observability';

import type { RealtimeMessage } from '../types/realtime-message.type';
import type { RealtimeSocketEnvelope } from '../types/realtime-socket-envelope.type';

const DEFAULT_EVENT_VERSION = '1.0.0';

export function buildRealtimeSocketEnvelope(
  message: RealtimeMessage,
): RealtimeSocketEnvelope {
  const ctx = getLoggerContext();
  const correlationId =
    message.meta?.correlationId ??
    ctx?.correlationId ??
    'unknown';
  const traceId = message.meta?.traceId;

  const meta: RealtimeSocketEnvelope['meta'] = { correlationId };
  if (typeof traceId === 'string' && traceId.trim()) {
    meta.traceId = traceId.trim();
  }

  return {
    eventId: message.eventId ?? 'unknown',
    eventType: message.eventType,
    eventVersion: message.eventVersion ?? DEFAULT_EVENT_VERSION,
    timestamp: message.timestamp ?? new Date().toISOString(),
    payload: message.payload,
    meta,
  };
}
