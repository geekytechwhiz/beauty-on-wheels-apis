import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { validateGetMasterVersionsRequest } from '../../validators/request.validators';

const c = getTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.master.versions.get',
    validator: validateGetMasterVersionsRequest,
  },
  (req: LambdaRequest) => c.handleGetMasterVersions(req),
);

export default main;
