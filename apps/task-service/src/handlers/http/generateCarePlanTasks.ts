import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import {
  getTaskHttpController, 
} from '../../controllers/task-http.controller';
import { generateCarePlanTasksHttpBodySchema } from '../../validators/task.schemas';
import {
  validateGenerateCarePlanTasksRequest,
  ValidatedGenerateCarePlanTasksRequest,
} from '../../validators/request.validators';

const c = getTaskHttpController();

const handler = async (req: LambdaRequest) =>
  c.handleGenerateCarePlanTasks(req as ValidatedGenerateCarePlanTasksRequest);

export const main = withApiHandler(
  {
    operation: 'task.carePlan.generate',
    bodySchema: generateCarePlanTasksHttpBodySchema,
    validator: validateGenerateCarePlanTasksRequest,
  },
  handler,
);

export default main;
