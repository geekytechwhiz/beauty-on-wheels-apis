import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { getAlertHttpController } from '../../controllers/alert-http.controller';

const c = getAlertHttpController();

const handler = async (req: LambdaRequest) => c.handlePatchAlert(req);

export const main = withLambdaHandler(handler);
