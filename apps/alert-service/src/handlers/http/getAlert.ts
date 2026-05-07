import { withApiHandler, type LambdaRequest } from '@api-hub/middleware';
import { getAlertHttpController } from '../../controllers/alert-http.controller';

const c = getAlertHttpController();

const handler = async (req: LambdaRequest) => c.handleGetAlert(req);

export const main = withApiHandler({
  operation: 'alert.get',
}, handler);
