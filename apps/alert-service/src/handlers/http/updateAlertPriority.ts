import { withLambdaHandler, type LambdaRequest }  from '@api-hub/middleware';
import { getAlertHttpController } from '../../controllers/alert-http.controller';
import { validatePriorityRequest } from '../../validators/request.validators';

const c = getAlertHttpController();

const handler = async (req: LambdaRequest) => c.handleUpdateAlertPriority(req);

export const main = withLambdaHandler(handler, {
  validator: validatePriorityRequest,
});

