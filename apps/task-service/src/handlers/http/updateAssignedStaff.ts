import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import { getTaskHttpController } from '../../controllers/task-http.controller';
import { updateAssignedStaffHttpBodySchema } from '../../validators/task.schemas';
import { validateUpdateAssignedStaffRequest } from '../../validators/request.validators';

const c = getTaskHttpController();

const handler = async (req: LambdaRequest) => c.handleUpdateAssignedStaff(req);

export const main = withApiHandler(
  {
    operation: 'task.runtime.reassignStaff',
    bodySchema: updateAssignedStaffHttpBodySchema,
    validator: validateUpdateAssignedStaffRequest,
  },
  handler,
);

export default main;
