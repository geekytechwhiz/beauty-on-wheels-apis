import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import { getTaskHttpController } from '../../controllers/task-http.controller';
import { updateTaskStateHttpBodySchema } from '../../validators/task.schemas';
import { validateUpdateTaskStateRequest } from '../../validators/request.validators';

const c = getTaskHttpController();

const handler = async (req: LambdaRequest) => c.handleUpdateTaskState(req);

export const main = withApiHandler(
  {
    operation: 'task.runtime.updateState',
    bodySchema: updateTaskStateHttpBodySchema,
    validator: validateUpdateTaskStateRequest,
  },
  handler,
);

export default main;
