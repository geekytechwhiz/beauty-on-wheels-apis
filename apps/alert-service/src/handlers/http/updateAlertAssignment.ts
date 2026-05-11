 import { withApiHandler} from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { getAlertHttpController } from '../../controllers/alert-http.controller';
import { validateAssignmentRequest } from '../../validators/request.validators';

const c = getAlertHttpController();

const handler = async (req: LambdaRequest) => c.handleUpdateAlertAssignment(req);

export const main = withApiHandler({
  operation: 'alert.updateAssignment',
  validator: validateAssignmentRequest,
}, handler);

export default main;

