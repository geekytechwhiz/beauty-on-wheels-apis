import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { validateDeriveTemplateRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.derive',
    useCreated: true,
    validator: validateDeriveTemplateRequest,
  },
  (req: LambdaRequest) => c.handleCloneToOrg(req),
);

export default main;
