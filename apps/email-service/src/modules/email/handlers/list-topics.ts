import { withApiHandler } from '@api-hub/middleware';
import {
  getEmailProvider,
  getTemplateRegistryProvider,
  getStorageProvider,
  getCampaignRepository,
} from '../../../common/providers/container.js';
import { EmailService } from '../services/EmailService.js';

const emailService = new EmailService(
  getEmailProvider(),
  getTemplateRegistryProvider(),
  getStorageProvider(),
  getCampaignRepository(),
);

const handler = async () => {
  const topics = await emailService.listTopics();

  return {
    // contactListName: process.env.CONTACT_LIST_NAME || 'email-system-contacts',
    topics,
  };
};

export const main = withApiHandler({ operation: 'email.listTopics' }, handler);

export default main;
