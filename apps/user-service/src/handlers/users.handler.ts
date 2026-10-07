import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getUsersController } from '../controllers/users.controller';

const controller = getUsersController();

export const handleLookupUserByPhone = withApiHandler(
  { operation: 'lookupUserByPhone' },
  async (request: LambdaRequest) => controller.lookupByPhone(request),
);

export const handleGetUser = withApiHandler(
  { operation: 'getUser' },
  async (request: LambdaRequest) => controller.getUser(request),
);
