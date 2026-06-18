import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import { getTaskHttpController } from '../../controllers/task-http.controller';
import { validateGetActionCenterItemsRequest } from '../../validators/request.validators';

const c = getTaskHttpController();

const handler = async (req: LambdaRequest) => c.handleGetActionCenterItems(req);

export const main = withApiHandler(
  {
    operation: 'task.actionCenter.list',
    validator: validateGetActionCenterItemsRequest,
  },
  handler,
);

export default main;
