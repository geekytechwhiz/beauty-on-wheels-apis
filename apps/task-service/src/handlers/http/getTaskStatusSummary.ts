import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import { getTaskHttpController } from '../../controllers/task-http.controller';
import { validateGetTaskStatusSummaryRequest } from '../../validators/request.validators';

const c = getTaskHttpController();

const handler = async (req: LambdaRequest) => c.handleGetTaskStatusSummary(req);

export const main = withApiHandler(
  {
    operation: 'task.carePlan.taskStatusSummary',
    validator: validateGetTaskStatusSummaryRequest,
  },
  handler,
);

export default main;
