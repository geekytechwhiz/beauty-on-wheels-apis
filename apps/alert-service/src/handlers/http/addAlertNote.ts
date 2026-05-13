import { withApiHandler  } from '@api-hub/middleware';
import { getAlertHttpController } from '../../controllers/alert-http.controller';
import { validateAddNoteRequest } from '../../validators/request.validators';
import { LambdaRequest } from '@api-hub/utils';

const c = getAlertHttpController();

const handler = async (req: LambdaRequest) => c.handleAddAlertNote(req);

export const main = withApiHandler({
  operation: 'alert.addNote',
  validator: validateAddNoteRequest,
}, handler);

export default main;
