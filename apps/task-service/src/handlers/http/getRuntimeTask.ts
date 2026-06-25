import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import {
  getTaskHttpController, 
} from '../../controllers/task-http.controller';
import { ValidatedGetRuntimeTaskRequest, validateGetRuntimeTaskRequest } from '../../validators/request.validators';

const c = getTaskHttpController();

const handler = async (req: LambdaRequest) =>
  c.handleGetRuntimeTask(req as ValidatedGetRuntimeTaskRequest);

export const main = withApiHandler(
  {
    operation: 'task.runtime.get',
    validator: validateGetRuntimeTaskRequest,
  },
  handler,
);

export default main;
