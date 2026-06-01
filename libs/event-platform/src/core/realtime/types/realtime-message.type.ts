export type RealtimeMessageMeta = {
  correlationId: string;
  traceId?: string;
};

export type RealtimeMessage = {
  channel: string;
  eventType: string;
  payload: Record<string, unknown>;
  recipientIds: string[];
  /** Realtime wire version (e.g. from transformer); copied to socket envelope. */
  eventVersion?: string;
  /** Populated before socket publish (from aggregate metadata or caller). */
  eventId?: string;
  timestamp?: string;
  meta?: RealtimeMessageMeta;
};
