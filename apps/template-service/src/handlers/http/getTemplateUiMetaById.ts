import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateUiMetaHttpController } from '../../controllers/template-ui-meta-http.controller';
import { validateGetUiMetaByIdRequest } from '../../validators/request.validators';

const c = getTemplateUiMetaHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.ui-meta.getById',
    validator: validateGetUiMetaByIdRequest,
  },
  (req: LambdaRequest) => c.handleGetUiMetaById(req),
);

export default main;
