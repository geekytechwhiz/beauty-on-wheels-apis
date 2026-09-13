import { Handler } from 'aws-lambda';
import { getCampaignRepository } from '../../../common/providers/container.js';
import { TrackingService } from '../services/TrackingService.js';

const trackingService = new TrackingService(getCampaignRepository());

export const main: Handler<any, any> = async event => {
  const campaignId = event.campaignId;
  if (!campaignId) {
    throw new Error('Missing campaignId in check campaign status event');
  }
  return trackingService.checkCampaignStatus(campaignId);
};
