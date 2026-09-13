/* eslint-disable mvrx/no-controller-business-logic */
import { SQSHandler, SQSBatchResponse } from 'aws-lambda';
import {
  getEmailProvider,
  getTemplateRegistryProvider,
  getStorageProvider,
  getCampaignRepository,
} from '../../../common/providers/container.js';
import { EmailService } from '../services/EmailService.js';
import { logger } from '../../../common/utils/logger.js';

const emailService = new EmailService(
  getEmailProvider(),
  getTemplateRegistryProvider(),
  getStorageProvider(),
  getCampaignRepository(),
);

export const main: SQSHandler = async (event): Promise<SQSBatchResponse> => {
  logger.info(`Processing ${event.Records.length} SQS email records`);
  const batchItemFailures = [];

  for (const record of event.Records) {
    try {
      const messageBody = JSON.parse(record.body);
      await emailService.sendBulkEmail(messageBody);
    } catch (error) {
      logger.error(`Error sending bulk email record ${record.messageId}`, { error });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
