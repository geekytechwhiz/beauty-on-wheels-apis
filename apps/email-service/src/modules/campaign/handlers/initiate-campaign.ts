import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { initiateCampaignSchema, InitiateCampaignInput } from '../dto/schemas.js';
import {
  getCampaignRepository,
  getRecipientRepository,
  getTemplateRegistryProvider,
  getStorageProvider,
  getQueueProvider,
  getOrchestratorProvider,
} from '../../../common/providers/container.js';
import { CampaignService } from '../services/CampaignService.js';

const campaignService = new CampaignService(
  getCampaignRepository(),
  getRecipientRepository(),
  getTemplateRegistryProvider(),
  getStorageProvider(),
  getQueueProvider(),
  getOrchestratorProvider(),
);

const handler = async (req: LambdaRequest) => {
  const body = req.body as InitiateCampaignInput;
  const result = await campaignService.initiateCampaign(body);

  return {
    message: 'Campaign initiated successfully',
    campaignId: result.campaignId,
    executionArn: result.executionArn,
    startDate: result.startDate,
    attachmentsUploaded: result.attachmentsUploaded,
    hasEmbeddedImages: result.hasEmbeddedImages,
  };
};

export const main = withApiHandler({
  operation: 'campaign.initiate',
  bodySchema: initiateCampaignSchema,
}, handler);

export default main;
