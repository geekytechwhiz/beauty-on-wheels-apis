 import { withApiHandler} from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { getAlertHttpController } from '../../controllers/alert-http.controller';

const c = getAlertHttpController();

const handler = async (req: LambdaRequest) => c.handleGetAlertMetadata(req);

export const main = withApiHandler({
  operation: 'alert.getMetadata',
}, handler);

export default main;
