import { Handler } from 'aws-lambda';
import { getRecipientRepository, getStorageProvider } from '../../../common/providers/container.js';
import { RecipientService } from '../services/RecipientService.js';
import { logger } from '../../../common/utils/logger.js';

const recipientService = new RecipientService(getRecipientRepository(), getStorageProvider());

export const main: Handler<any, any> = async event => {
  logger.info('CSV Processor event received', { event });

  try {
    let records: Array<{ bucket: string; key: string }> = [];

    if (event.Records && Array.isArray(event.Records)) {
      // Direct S3 event notification format
      records = event.Records.map((r: any) => ({
        bucket: r.s3?.bucket?.name,
        key: r.s3?.object?.key,
      }));
    } else if (event.source === 'aws.s3' && event.detail) {
      // EventBridge S3 notification format
      records = [
        {
          bucket: event.detail.bucket?.name,
          key: event.detail.object?.key,
        },
      ];
    } else {
      logger.error('Unknown event format for CSV Processor', { event });
      throw new Error('Unsupported event format');
    }

    for (const record of records) {
      if (!record.bucket || !record.key) {
        logger.warn('Skipping record missing bucket or key', { record });
        continue;
      }

      // Decode S3 Key (e.g. unquote plus / space encodings)
      const decodedKey = decodeURIComponent(record.key.replace(/\+/g, ' '));

      // We only process .csv files
      if (!decodedKey.toLowerCase().endsWith('.csv')) {
        logger.info(`Ignoring non-CSV file: ${decodedKey}`);
        continue;
      }

      const result = await recipientService.processUploadedCsv(record.bucket, decodedKey);
      logger.info(`Processed uploaded S3 file: ${decodedKey}`, { result });
    }

    return {
      statusCode: 200,
      body: 'CSV processed successfully',
    };
  } catch (error) {
    logger.error('Error in CSV Processor Lambda execution', { error });
    throw error;
  }
};
