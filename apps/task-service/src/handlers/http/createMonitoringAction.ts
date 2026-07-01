import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import {
  getTaskHttpController
} from '../../controllers/task-http.controller';
import { createMonitoringActionHttpBodySchema } from '../../validators/task.schemas';
import { validateCreateMonitoringActionRequest, ValidatedCreateMonitoringActionRequest } from '../../validators/request.validators';

const c = getTaskHttpController();

const handler = async (req: LambdaRequest) =>
  c.handleCreateMonitoringAction(req as ValidatedCreateMonitoringActionRequest);

export const main = withApiHandler(
  {
    operation: 'task.monitoringAction.create',
    bodySchema: createMonitoringActionHttpBodySchema,
    validator: validateCreateMonitoringActionRequest,
  },
  handler,
);

export default main;
