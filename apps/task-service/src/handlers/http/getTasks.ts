import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import { getTaskHttpController } from '../../controllers/task-http.controller';
import { validateGetTasksRequest } from '../../validators/request.validators';

const c = getTaskHttpController();

const handler = async (req: LambdaRequest) => c.handleGetTasks(req);

export const main = withApiHandler(
  {
    operation: 'task.runtime.list',
    validator: validateGetTasksRequest,
  },
  handler,
);

export default main;
