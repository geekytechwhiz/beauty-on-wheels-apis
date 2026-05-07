import { withApiHandler } from '@api-hub/middleware';

import { getAlertHttpController } from '../../controllers/alert-http.controller';
import { createAlertHttpBodySchema } from '../../validators/alert.schemas';
import { validateCreateAlertRequest } from '../../validators/request.validators';

const controller = getAlertHttpController();
 
export const main = withApiHandler(
  {
    operation: 'alert.create',
    bodySchema: createAlertHttpBodySchema,
    validator: validateCreateAlertRequest,
  },
  controller.handleCreateAlert
);
