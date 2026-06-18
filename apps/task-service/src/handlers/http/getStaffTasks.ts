import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import { getTaskHttpController } from '../../controllers/task-http.controller';
import { validateGetStaffTasksRequest } from '../../validators/request.validators';

const c = getTaskHttpController();

const handler = async (req: LambdaRequest) => c.handleGetStaffTasks(req);

export const main = withApiHandler(
  {
    operation: 'task.staff.list',
    validator: validateGetStaffTasksRequest,
  },
  handler,
);

export default main;
