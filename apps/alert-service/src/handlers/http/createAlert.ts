import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { getAlertHttpController } from '../../controllers/alert-http.controller';
import { createAlertHttpBodySchema } from '../../validators/alert.schemas';
import { validateCreateAlertRequest } from '../../validators/request.validators';


const c = getAlertHttpController();

const handler = async (req: LambdaRequest) => c.handleCreateAlert(req);

export const main = withApiHandler(
  {
    operation: 'alert.create',
    bodySchema: createAlertHttpBodySchema,
    validator: validateCreateAlertRequest,
  },
  handler,
);

export default main;
