import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateUiMetaHttpController } from '../../controllers/template-ui-meta-http.controller';
import { validateUpdateUiMetaRequest } from '../../validators/request.validators';
import { upsertUiMetaBodySchema } from '../../validators/template.schemas';

const c = getTemplateUiMetaHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.ui-meta.update',
    bodySchema: upsertUiMetaBodySchema,
    validator: validateUpdateUiMetaRequest,
  },
  (req: LambdaRequest) => c.handleUpdateUiMeta(req),
);

export default main;
