import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { sendAdhocEmailSchema } from '../dto/schemas.js';
import { AdhocEmailRequest } from '../domain/types.js';
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

const handler = async (req: LambdaRequest) =>
  emailService.sendAdhocEmail(req.body as AdhocEmailRequest);

export const main = withApiHandler({
  operation: 'email.sendAdhoc',
  bodySchema: sendAdhocEmailSchema,
}, handler);

export default main;
