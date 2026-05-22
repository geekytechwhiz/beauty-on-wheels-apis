export type RealtimeMessage = {
  channel: string;
  eventType: string;
  payload: Record<string, unknown>;
  recipientIds: string[];
};
