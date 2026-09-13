import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getPermissionsController } from '../controllers/permissions.controller';
import { requireAuth } from '../auth/require-auth';

const controller = getPermissionsController();

export const handleGetpermissions = withApiHandler(
  {
    operation: 'getpermissions',
    validator: async (request: LambdaRequest) => {
      await requireAuth(request);
    },
  },
  async (request: LambdaRequest) => controller.handleGetpermissions(request),
);
