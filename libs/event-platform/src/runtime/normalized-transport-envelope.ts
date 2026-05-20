import type { EventTransport } from '../core/schema/define-event';
import type { ReplayMetadata } from '../governance/replay-metadata';

export type NormalizedTransportKind = EventTransport | 'dynamodb-stream';

export interface NormalizedTransportEnvelope<TPayload = unknown> {
  transport: NormalizedTransportKind;
  raw: unknown;
  payloadCandidate: unknown;
  attributes: {
    messageId?: string;
    receiptHandle?: string;
    approximateReceiveCount?: number;
    fifoGroupId?: string;
    fifoDeduplicationId?: string;
    eventSourceArn?: string;
    sequenceNumber?: string;
    correlationHint?: string;
    replay?: ReplayMetadata;
  };
  receivedAt: string;
}
