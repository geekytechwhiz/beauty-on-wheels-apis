import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { validateGetMasterVersionsRequest } from '../../validators/request.validators';

const c = getTemplateHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.versions.get',
    validator: validateGetMasterVersionsRequest,
  },
  (req: LambdaRequest) => c.handleGetMasterVersions(req),
);

export default main;
