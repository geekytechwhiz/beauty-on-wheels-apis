import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { validateOrgVersionStatusRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.org.version-status',
    validator: validateOrgVersionStatusRequest,
  },
  (req: LambdaRequest) => c.handleGetOrgVersionStatus(req),
);

export default main;
