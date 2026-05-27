import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { validateListMasterRequest } from '../../validators/request.validators';

const c = getTemplateHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.list',
    validator: validateListMasterRequest,
  },
  (req: LambdaRequest) => c.handleListMaster(req),
);

export default main;
