import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { getAlertHttpController } from '../../controllers/alert-http.controller';  
import { validateCreateAlertRequest } from '../../validators/request.validators';

const c = getAlertHttpController();

const handler = async (req: LambdaRequest) => c.handleCreateAlert(req);

export const main = withLambdaHandler(handler, {
  validator: validateCreateAlertRequest,
});
