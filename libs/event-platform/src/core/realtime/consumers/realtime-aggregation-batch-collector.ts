import type { RealtimeAggregateMessage } from '../types/realtime-aggregate-message.type';

export type RealtimeAggregationBatchEntry = {
  messageId: string;
  message: RealtimeAggregateMessage;
};

export class RealtimeAggregationBatchCollector {
  private entries: RealtimeAggregationBatchEntry[] = [];

  reset(): void {
    this.entries = [];
  }

  record(messageId: string, message: RealtimeAggregateMessage): void {
    this.entries.push({ messageId, message });
  }

  drain(): RealtimeAggregateMessage[] {
    return this.entries.map((entry) => entry.message);
  }

  messageIds(): string[] {
    return this.entries.map((entry) => entry.messageId);
  }
}

export function mergeBatchFailures(
  response: { batchItemFailures: Array<{ itemIdentifier: string }> },
  messageIds: string[],
): { batchItemFailures: Array<{ itemIdentifier: string }> } {
  const existing = new Set(response.batchItemFailures.map((f) => f.itemIdentifier));

  for (const messageId of messageIds) {
    existing.add(messageId);
  }

  return {
    batchItemFailures: [...existing].map((itemIdentifier) => ({ itemIdentifier })),
  };
}

export function toAggregateMessage(payload: {
  recipients: RealtimeAggregateMessage['recipients'];
  message: RealtimeAggregateMessage['message'];
  metadata: RealtimeAggregateMessage['metadata'];
}): RealtimeAggregateMessage {
  return {
    recipients: payload.recipients,
    message: payload.message,
    metadata: payload.metadata,
  };
}
