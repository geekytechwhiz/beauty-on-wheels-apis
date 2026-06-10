import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import { getTaskHttpController } from '../../controllers/task-http.controller';
import { validateGetRuntimeTaskHistoryRequest } from '../../validators/request.validators';

const c = getTaskHttpController();

const handler = async (req: LambdaRequest) => c.handleGetRuntimeTaskHistory(req);

export const main = withApiHandler(
  {
    operation: 'task.runtime.history.get',
    validator: validateGetRuntimeTaskHistoryRequest,
  },
  handler,
);

export default main;
