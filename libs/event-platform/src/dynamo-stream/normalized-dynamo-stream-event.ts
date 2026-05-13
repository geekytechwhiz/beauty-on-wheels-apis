import type { DynamoDBRecord } from 'aws-lambda';

/**
 * Canonical, unmarshalled view of a DynamoDB Streams change record for routing and mapping.
 * AttributeValue maps are converted to plain JS objects; handlers never see raw DynamoDB wire.
 */
export type NormalizedDynamoStreamEvent = {
  transport: 'dynamodb-stream';
  eventID: string;
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE' | string;
  sequenceNumber?: string;
  streamArn?: string;
  tableName?: string;
  /** Unmarshalled partition + sort key attributes (when present). */
  keys: Record<string, unknown>;
  /** Unmarshalled pre-image (REMOVE / MODIFY). */
  oldImage?: Record<string, unknown>;
  /** Unmarshalled post-image (INSERT / MODIFY). */
  newImage?: Record<string, unknown>;
  approximateCreationDateTime?: number;
  correlationId?: string;
  traceId?: string;
  causationId?: string;
  /** Best-effort replay / delivery hints from the item when present. */
  retryCount?: number;
  shardId?: string;
  /** Original Lambda stream record for DLQ / transport retry payloads. */
  rawRecord: DynamoDBRecord;
};
