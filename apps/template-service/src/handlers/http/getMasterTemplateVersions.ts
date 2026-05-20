import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { validateGetMasterVersionsRequest } from '../../validators/request.validators';

export const main = withApiHandler(
  {
    operation: 'template.master.versions.get',
    validator: validateGetMasterVersionsRequest,
  },
  (req: LambdaRequest) => getTemplateHttpController().handleGetMasterVersions(req),
);

export default main;
