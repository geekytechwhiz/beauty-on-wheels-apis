import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getProfileController } from '../controllers/profile.controller';
import { requireAuth } from '../auth/require-auth';

const controller = getProfileController();

export const handler = withApiHandler(
  {
    operation: 'getme',
    validator: async (request: LambdaRequest) => {
      await requireAuth(request);
    },
  },
  async (request: LambdaRequest) => controller.handleGetme(request),
);
