import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { validateGetOrgVersionsRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

export const main = withApiHandler(
  {
    operation: 'template.org.versions.get',
    validator: validateGetOrgVersionsRequest,
  },
  (req: LambdaRequest) => c.handleGetOrgVersions(req),
);

export default main;
