import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { validateDeriveTemplateRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

export const main = withApiHandler(
  {
    operation: 'template.derive',
    validator: validateDeriveTemplateRequest,
  },
  (req: LambdaRequest) => c.handleCloneToOrg(req),
);

export default main;
