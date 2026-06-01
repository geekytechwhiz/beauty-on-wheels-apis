import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateUiMetaHttpController } from '../../controllers/template-ui-meta-http.controller';
import { validateGetUiMetaByTypeRequest } from '../../validators/request.validators';

const c = getTemplateUiMetaHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.ui-meta.getByType',
    validator: validateGetUiMetaByTypeRequest,
  },
  (req: LambdaRequest) => c.handleGetUiMetaByType(req),
);

export default main;
