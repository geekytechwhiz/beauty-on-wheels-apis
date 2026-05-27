import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { validateCreateMasterRequest } from '../../validators/request.validators';
import { createMasterTemplateBodySchema } from '../../validators/template.schemas';

const c = getTemplateHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.create',
    bodySchema: createMasterTemplateBodySchema,
    validator: validateCreateMasterRequest,
  },
  (req: LambdaRequest) => c.handleCreateMaster(req),
);

export default main;
