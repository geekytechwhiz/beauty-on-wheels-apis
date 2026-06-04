import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { validateUpdateMasterVersionRequest } from '../../validators/request.validators';
import { updateMasterTemplateBodySchema } from '../../validators/template.schemas';

const c = getTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.master.version.update',
    bodySchema: updateMasterTemplateBodySchema,
    validator: validateUpdateMasterVersionRequest,
  },
  (req: LambdaRequest) => c.handleUpdateMasterVersion(req),
);

export default main;
