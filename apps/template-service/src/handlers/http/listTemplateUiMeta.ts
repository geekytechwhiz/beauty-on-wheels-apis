import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateUiMetaHttpController } from '../../controllers/template-ui-meta-http.controller';
import { validateListUiMetaRequest } from '../../validators/request.validators';

const c = getTemplateUiMetaHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.ui-meta.list',
    validator: validateListUiMetaRequest,
  },
  (req: LambdaRequest) => c.handleListUiMeta(req),
);

export default main;
