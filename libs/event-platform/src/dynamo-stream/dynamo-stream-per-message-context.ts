import type { DynamoDBRecord } from 'aws-lambda';

import {
  isDynamoDbStreamRecord,
  normalizeDynamoStreamRecord,
} from './normalize-dynamo-stream-record';

/**
 * AsyncLocalStorage / logger context fields for one DynamoDB stream record (concurrent batches).
 */
export function buildDynamoStreamPerMessageLoggerContext(input: {
  rawRecord: unknown;
  operation: string;
  lambdaAwsRequestId?: string;
}): Record<string, string | number | undefined> {
  const r = isDynamoDbStreamRecord(input.rawRecord)
    ? input.rawRecord
    : undefined;
  const norm = r ? normalizeDynamoStreamRecord(r) : undefined;
  const correlation =
    norm?.correlationId ??
    (r?.eventID && typeof r.eventID === 'string' ? r.eventID : undefined) ??
    'unknown';

  return {
    correlationId: correlation,
    awsRequestId: input.lambdaAwsRequestId,
    operation: input.operation,
    messageId: r?.eventID ?? 'unknown',
    dynamodbEventID: r?.eventID,
    dynamodbSequenceNumber: r?.dynamodb?.SequenceNumber,
    dynamodbTableName: norm?.tableName,
    dynamodbEventName: norm?.eventName,
    ...(norm?.traceId ? { traceId: norm.traceId } : {}),
  };
}

export function getDynamoStreamRecordShape(
  raw: unknown,
): DynamoDBRecord | undefined {
  return isDynamoDbStreamRecord(raw) ? raw : undefined;
}
