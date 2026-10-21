import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOfferingsController } from '../controllers/offerings.controller';

const controller = getOfferingsController();

export const getOfferings = withApiHandler(
  { operation: 'getOfferings' },
  async (request: LambdaRequest) => controller.handleGetOfferings(request),
);
