import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { validateListOrgTemplatesRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.org.list',
    validator: validateListOrgTemplatesRequest,
  },
  (req: LambdaRequest) => c.handleListOrg(req),
);

export default main;
