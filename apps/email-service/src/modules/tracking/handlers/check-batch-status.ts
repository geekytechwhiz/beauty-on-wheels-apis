import { Handler } from 'aws-lambda';
import { getCampaignRepository } from '../../../common/providers/container.js';
import { TrackingService } from '../services/TrackingService.js';

const trackingService = new TrackingService(getCampaignRepository());

export const main: Handler<any, any> = async event => {
  return trackingService.checkBatchStatus(event);
};
