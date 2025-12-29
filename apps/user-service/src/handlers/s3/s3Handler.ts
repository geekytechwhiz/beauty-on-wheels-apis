import { S3Event } from 'aws-lambda';
import { UserService } from '../../services/user.service';
import { createLogger, extractCorrelationId, serializeError, createChildLogger } from '@api-hub/logger';
import { s3EventSchema } from '../../validation/user.validation';
import { InvalidEventError } from '../../utils/errors';
import { generateFileId } from '../../utils/helpers';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

export async function uploadUserFile(event: S3Event): Promise<void> {
  const correlationId = extractCorrelationId(event as unknown as { headers?: Record<string, string> });
  const logger = createChildLogger(baseLogger, { correlationId });
  logger.info({ event: 'uploadUserFile_received', recordCount: event.Records.length });

  const validation = s3EventSchema.safeParse(event);
  if (!validation.success) {
    logger.error({ event: 'uploadUserFile_validation_error', errors: validation.error });
    throw new InvalidEventError('Invalid S3 event structure');
  }

  for (const record of event.Records) {
    try {
      const bucket = record.s3.bucket.name;
      const key = record.s3.object.key;
      const recordLogger = createChildLogger(baseLogger, { correlationId, bucket, key });

      recordLogger.info({ event: 'uploadUserFile_processing' });

      const userIdMatch = key.match(/users\/([^/]+)\//);
      if (!userIdMatch || !userIdMatch[1]) {
        recordLogger.warn({ event: 'uploadUserFile_invalid_key', message: 'S3 key does not contain userId' });
        continue;
      }

      const userId = userIdMatch[1];
      const fileName = key.split('/').pop() || 'unknown';
      const fileId = generateFileId();

      await userService.createUserFile(userId, fileId, fileName, key, correlationId);

      recordLogger.info({ event: 'uploadUserFile_success', userId, fileId, fileName });
    } catch (err) {
      const recordLogger = createChildLogger(baseLogger, { correlationId });
      recordLogger.error({ event: 'uploadUserFile_error', err: serializeError(err), message: 'Failed to process S3 record' });
    }
  }
}

