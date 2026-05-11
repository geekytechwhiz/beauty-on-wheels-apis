 import { withApiHandler} from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { getAlertHttpController } from '../../controllers/alert-http.controller';

const c = getAlertHttpController();

const handler = async (req: LambdaRequest) => c.handleGetAlertActivity(req);

export const main = withApiHandler({
  operation: 'alert.getActivity',
}, handler);

export default main;
