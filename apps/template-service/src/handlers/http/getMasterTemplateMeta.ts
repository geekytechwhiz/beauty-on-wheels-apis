import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { validateGetMasterMetaRequest } from '../../validators/request.validators';

export const main = withApiHandler(
  {
    operation: 'template.master.meta.get',
    validator: validateGetMasterMetaRequest,
  },
  (req: LambdaRequest) => getTemplateHttpController().handleGetMasterMeta(req),
);

export default main;
