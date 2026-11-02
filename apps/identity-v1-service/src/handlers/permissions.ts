import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getPermissionsController } from '../controllers/permissions.controller';

const controller = getPermissionsController();

export const handleGetpermissions = withApiHandler(
  {
    operation: 'getpermissions',
    validator: () => undefined,
  },
  async (request: LambdaRequest) => controller.handleGetpermissions(request),
);
