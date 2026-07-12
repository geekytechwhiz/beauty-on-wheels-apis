import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getPermissionsController } from '../controllers/permissions.controller';

const controller = getPermissionsController();

export const handler = withApiHandler(
  {
    operation: 'getpermissions',
  },
  async (request: LambdaRequest) => controller.handleGetpermissions(request),
);
