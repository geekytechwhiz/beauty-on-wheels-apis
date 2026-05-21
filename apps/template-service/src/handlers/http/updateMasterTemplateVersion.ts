import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { validateUpdateMasterVersionRequest } from '../../validators/request.validators';
import { updateMasterTemplateBodySchema } from '../../validators/template.schemas';

const c = getTemplateHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.version.update',
    bodySchema: updateMasterTemplateBodySchema,
    validator: validateUpdateMasterVersionRequest,
  },
  (req: LambdaRequest) => c.handleUpdateMasterVersion(req),
);

export default main;
