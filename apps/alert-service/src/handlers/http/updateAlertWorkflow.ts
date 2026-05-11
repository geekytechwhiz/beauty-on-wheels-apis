 import { withApiHandler} from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { getAlertHttpController } from '../../controllers/alert-http.controller';
import { validateWorkflowRequest } from '../../validators/request.validators';

const c = getAlertHttpController();

const handler = async (req: LambdaRequest) => c.handleUpdateAlertWorkflow(req);

export const main = withApiHandler({
  operation: 'alert.updateWorkflow',
  validator: validateWorkflowRequest,
}, handler);

export default main;
