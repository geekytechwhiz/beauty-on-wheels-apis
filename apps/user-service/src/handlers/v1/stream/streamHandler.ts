import { DynamoDBStreamevent: any, DynamoDBRecord } from 'aws-lambda';
import { createLogger, extractCorrelationId, serializeError, createChildLogger } from '@api-hub/observability';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

export async function userProfileStreamHandler(event: DynamoDBStreamEvent): Promise<void> {
  const correlationId = extractCorrelationId(event as unknown as { headers?: Record<string, string> });
  const logger = createChildLogger(baseLogger, { correlationId });
  logger.info({ event: 'userProfileStreamHandler_received', recordCount: event.Records.length });

  const processedSequenceNumbers = new Set<string>();

  for (const record of event.Records) {
    const sequenceNumber = record.dynamodb?.SequenceNumber;
    if (sequenceNumber && processedSequenceNumbers.has(sequenceNumber)) {
      logger.warn({
        event: 'userProfileStreamHandler_duplicate',
        sequenceNumber,
        message: 'Duplicate stream record ignored',
      });
      continue;
    }

    if (sequenceNumber) {
      processedSequenceNumbers.add(sequenceNumber);
    }

    try {
      const eventName = record.eventName;

      if (eventName !== 'INSERT' && eventName !== 'MODIFY') {
        logger.info({ event: 'userProfileStreamHandler_skipped', eventName, message: 'Skipping non-INSERT/MODIFY event' });
        continue;
      }

      let item: Record<string, unknown>;
      if (eventName === 'INSERT' && record.dynamodb?.NewImage) {
        item = unmarshall(record.dynamodb.NewImage as any);
      } else if (eventName === 'MODIFY' && record.dynamodb?.NewImage) {
        item = unmarshall(record.dynamodb.NewImage as any);
      } else {
        logger.warn({ event: 'userProfileStreamHandler_no_image', eventName, message: 'No image data in record' });
        continue;
      }

      const itemType = item.itemType as string;
      const userId = item.userId as string;

      if (!userId) {
        logger.warn({ event: 'userProfileStreamHandler_no_userId', itemType, message: 'No userId in record' });
        continue;
      }

      const recordLogger = createChildLogger(baseLogger, { correlationId, userId, itemType, eventName });
      recordLogger.info({
        event: 'userProfileStreamHandler_processing',
        message: 'Processing stream record',
      });

      if (itemType === 'USER') {
        recordLogger.info({
          event: 'userProfileStreamHandler_audit',
          message: 'User profile change detected - audit event',
        });
      }

      recordLogger.info({
        event: 'userProfileStreamHandler_success',
        message: 'Stream record processed successfully',
      });
    } catch (err) {
      const recordLogger = createChildLogger(baseLogger, { correlationId, sequenceNumber });
      recordLogger.error({
        event: 'userProfileStreamHandler_error',
        err: serializeError(err),
        message: 'Failed to process stream record',
      });
    }
  }
}

