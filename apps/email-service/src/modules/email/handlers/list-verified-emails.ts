import { withApiHandler } from '@api-hub/middleware';
import {
  getEmailProvider,
  getTemplateRegistryProvider,
  getStorageProvider,
  getCampaignRepository,
} from '../../../common/providers/container.js';
import { EmailService } from '../services/EmailService.js';
import { getEmailDeliveryStore } from './composition.js';

const emailService = new EmailService(
  getEmailProvider(),
  getTemplateRegistryProvider(),
  getStorageProvider(),
  getCampaignRepository(),
  getEmailDeliveryStore(),
);

const handler = async () => {
  const emails = await emailService.listVerifiedEmails();

  return { emails };
};

export const main = withApiHandler({ operation: 'email.listVerifiedEmails' }, handler);

export default main;
