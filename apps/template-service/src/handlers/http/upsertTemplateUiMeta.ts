import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateUiMetaHttpController } from '../../controllers/template-ui-meta-http.controller';
import { validateUpsertUiMetaRequest } from '../../validators/request.validators';

const c = getTemplateUiMetaHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.ui-meta.upsert',
    validator: validateUpsertUiMetaRequest,
  },
  (req: LambdaRequest) => c.handleUpsertUiMeta(req),
);

export default main;
