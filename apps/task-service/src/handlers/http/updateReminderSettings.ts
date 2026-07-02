import { withApiHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';

import {
  getTaskHttpController
} from '../../controllers/task-http.controller';
import { updateReminderSettingsHttpBodySchema } from '../../validators/task.schemas';
import { ValidatedUpdateReminderSettingsRequest, validateUpdateReminderSettingsRequest } from '../../validators/request.validators';

const c = getTaskHttpController();

const handler = async (req: LambdaRequest) =>
  c.handleUpdateReminderSettings(req as ValidatedUpdateReminderSettingsRequest);

export const main = withApiHandler(
  {
    operation: 'task.runtime.updateReminderSettings',
    bodySchema: updateReminderSettingsHttpBodySchema,
    validator: validateUpdateReminderSettingsRequest,
  },
  handler,
);

export default main;
