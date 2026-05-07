import { withApiHandler, type LambdaRequest } from '@api-hub/middleware';
import { getAlertHttpController } from '../../controllers/alert-http.controller';
import { validateWorkflowRequest } from '../../validators/request.validators';

const c = getAlertHttpController();

const handler = async (req: LambdaRequest) => c.handleUpdateAlertWorkflow(req);

export const main = withApiHandler({
  operation: 'alert.updateWorkflow',
  validator: validateWorkflowRequest,
}, handler);

export default main;
