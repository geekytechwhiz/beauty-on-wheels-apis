import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateUiMetaHttpController } from '../../controllers/template-ui-meta-http.controller';
import { validateCreateUiMetaRequest } from '../../validators/request.validators';
import { createUiMetaBodySchema } from '../../validators/template.schemas';

const c = getTemplateUiMetaHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.ui-meta.create',
    bodySchema: createUiMetaBodySchema,
    validator: validateCreateUiMetaRequest,
  },
  (req: LambdaRequest) => c.handleCreateUiMeta(req),
);

export default main;
