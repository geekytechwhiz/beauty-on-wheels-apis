import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { validateGetMasterMetaRequest } from '../../validators/request.validators';

const c = getTemplateHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.meta.get',
    validator: validateGetMasterMetaRequest,
  },
  (req: LambdaRequest) => c.handleGetMasterMeta(req),
);

export default main;
