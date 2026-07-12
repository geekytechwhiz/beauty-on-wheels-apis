import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getProfileController } from '../controllers/profile.controller';

const controller = getProfileController();

export const handler = withApiHandler(
  {
    operation: 'getme',
  },
  async (request: LambdaRequest) => controller.handleGetme(request),
);
