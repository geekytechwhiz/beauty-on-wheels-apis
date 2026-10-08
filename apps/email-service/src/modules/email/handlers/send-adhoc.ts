import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { sendAdhocEmailSchema } from '../dto/schemas.js';
import { readCallerIdempotencyKey } from '../domain/adhoc-idempotency.js';
import { AdhocEmailRequest } from '../domain/types.js';
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

const handler = async (req: LambdaRequest) =>
  emailService.sendAdhocEmail(req.body as AdhocEmailRequest, {
    idempotencyKey: readCallerIdempotencyKey(req.event?.headers),
    correlationId: req.context?.correlationId,
  });

export const main = withApiHandler({
  operation: 'email.sendAdhoc',
  bodySchema: sendAdhocEmailSchema,
}, handler);

export default main;
