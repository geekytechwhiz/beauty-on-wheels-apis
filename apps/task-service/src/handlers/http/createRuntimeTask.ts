import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import {
  getTaskHttpController, 
} from '../../controllers/task-http.controller';
import { createRuntimeTaskHttpBodySchema } from '../../validators/task.schemas';
import { validateCreateRuntimeTaskRequest, ValidatedCreateRuntimeTaskRequest } from '../../validators/request.validators';

const c = getTaskHttpController();

const handler = async (req: LambdaRequest) =>
  c.handleCreateRuntimeTask(req as ValidatedCreateRuntimeTaskRequest);

export const main = withApiHandler(
  {
    operation: 'task.runtime.create',
    bodySchema: createRuntimeTaskHttpBodySchema,
    validator: validateCreateRuntimeTaskRequest,
  },
  handler,
);

export default main;
