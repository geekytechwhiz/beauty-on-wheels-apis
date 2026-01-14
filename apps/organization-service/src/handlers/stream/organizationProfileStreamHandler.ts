import { DynamoDBStreamHandler } from 'aws-lambda';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { dynamoDBStreamEventSchema } from '../../validation/event.validation';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

export const main: DynamoDBStreamHandler = async (event) => {
  const logger = createChildLogger(baseLogger, {});
  logger.info({ event: 'organizationProfileStreamHandler_received', recordCount: event.Records.length });

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  try {
    const validationResult = dynamoDBStreamEventSchema.safeParse(event);
    if (!validationResult.success) {
      logger.error({ event: 'organizationProfileStreamHandler_validation_error', errors: validationResult.error.errors });
      // Mark all records as failed
      return {
        batchItemFailures: event.Records.map((record) => ({ itemIdentifier: record.eventID })),
      };
    }

    for (const record of event.Records) {
      try {
        const item = record.dynamodb.NewImage || record.dynamodb.OldImage;
        if (!item) {
          logger.warn({ event: 'organizationProfileStreamHandler_no_item', eventID: record.eventID });
          continue;
        }

        const sk = item.sk?.S || item.sk;
        if (sk !== 'ORG_DETAILS') {
          // Skip non-ORG_DETAILS items
          logger.debug({ event: 'organizationProfileStreamHandler_skipped', eventID: record.eventID, sk });
          continue;
        }

        const eventName = record.eventName;
        const organizationId = item.organizationId?.S || item.organizationId;

        logger.info({
          event: 'organizationProfileStreamHandler_processed',
          eventID: record.eventID,
          eventName,
          organizationId,
        });

        // Here you can add audit logging, analytics, or notification logic
        // For now, we just log the event
      } catch (err) {
        logger.error({
          event: 'organizationProfileStreamHandler_record_error',
          eventID: record.eventID,
          err: serializeError(err),
        });
        batchItemFailures.push({ itemIdentifier: record.eventID });
      }
    }

    return {
      batchItemFailures: batchItemFailures.length > 0 ? batchItemFailures : undefined,
    };
  } catch (err) {
    logger.error({ event: 'organizationProfileStreamHandler_error', err: serializeError(err) });
    // Mark all records as failed
    return {
      batchItemFailures: event.Records.map((record) => ({ itemIdentifier: record.eventID })),
    };
  }
};
