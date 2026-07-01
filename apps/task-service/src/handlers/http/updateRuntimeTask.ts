import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import {
  getTaskHttpController, 
} from '../../controllers/task-http.controller';
import { updateRuntimeTaskHttpBodySchema } from '../../validators/task.schemas';
import { ValidatedUpdateRuntimeTaskRequest, validateUpdateRuntimeTaskRequest } from '../../validators/request.validators';

const c = getTaskHttpController();

const handler = async (req: LambdaRequest) =>
  c.handleUpdateRuntimeTask(req as ValidatedUpdateRuntimeTaskRequest);

export const main = withApiHandler(
  {
    operation: 'task.runtime.updateMetadata',
    bodySchema: updateRuntimeTaskHttpBodySchema,
    validator: validateUpdateRuntimeTaskRequest,
  },
  handler,
);

export default main;
