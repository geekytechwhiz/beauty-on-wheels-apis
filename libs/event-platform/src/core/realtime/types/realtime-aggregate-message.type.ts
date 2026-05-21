import type { RealtimeMessage } from './realtime-message.type';
import type { RealtimeRecipient } from './realtime-recipient.type';

export type RealtimeAggregateMessage = {
  recipients: RealtimeRecipient[];
  message: RealtimeMessage;
  metadata: {
    correlationId: string;
    eventId: string;
    eventType: string;
    timestamp: string;
  };
};
