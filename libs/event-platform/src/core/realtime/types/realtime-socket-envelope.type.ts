/** Wire shape delivered to WebSocket clients (aligned with {@link BaseEvent}, without source/idempotencyKey). */
export type RealtimeSocketEnvelope = {
  eventId: string;
  eventType: string;
  eventVersion: string;
  timestamp: string;
  payload: Record<string, unknown>;
  meta: {
    correlationId: string;
    traceId?: string;
  };
};
