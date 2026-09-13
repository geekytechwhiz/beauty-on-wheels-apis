import { Handler } from 'aws-lambda';
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

export const main: Handler<any, any> = async event => {
  return campaignService.setupCampaign(event);
};
