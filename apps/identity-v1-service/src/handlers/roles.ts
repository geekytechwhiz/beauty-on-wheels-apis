import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getRolesController } from '../controllers/roles.controller';
import { requireAuth } from '../auth/require-auth';

const controller = getRolesController();

export const handleGetroles = withApiHandler(
  {
    operation: 'getroles',
    validator: async (request: LambdaRequest) => {
      await requireAuth(request);
    },
  },
  async (request: LambdaRequest) => controller.handleGetroles(request),
);
