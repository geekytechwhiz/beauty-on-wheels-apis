import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { validateListMasterRequest } from '../../validators/request.validators';

const c = getTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.master.list',
    validator: validateListMasterRequest,
  },
  (req: LambdaRequest) => c.handleListMaster(req),
);

export default main;
