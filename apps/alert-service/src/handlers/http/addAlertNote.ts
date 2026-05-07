import { withLambdaHandler, type LambdaRequest } from '@api-hub/utils';
import { getAlertHttpController } from '../../controllers/alert-http.controller';
import { validateAddNoteRequest } from '../../validators/request.validators';

const c = getAlertHttpController();

const handler = async (req: LambdaRequest) => c.handleAddAlertNote(req);

export const main = withLambdaHandler(handler, {
  validator: validateAddNoteRequest,
});

export default main;
