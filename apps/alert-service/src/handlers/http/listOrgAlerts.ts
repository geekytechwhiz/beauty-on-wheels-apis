import { withLambdaHandler, type LambdaRequest } from '@api-hub/middleware';
import { getAlertHttpController } from '../../controllers/alert-http.controller';

const c = getAlertHttpController();

const handler = async (req: LambdaRequest) => c.handleListOrgAlerts(req);

export const main = withLambdaHandler(handler);
