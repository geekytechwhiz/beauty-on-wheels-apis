import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { validateCloneOrgTemplateRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

export const main = withApiHandler(
  {
    operation: 'template.org.clone',
    validator: validateCloneOrgTemplateRequest,
  },
  (req: LambdaRequest) => c.handleCloneToOrg(req),
);

export default main;
