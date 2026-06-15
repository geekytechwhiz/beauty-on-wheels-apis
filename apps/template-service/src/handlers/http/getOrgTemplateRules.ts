import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { validateGetOrgTemplateRulesRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.org.rules.get',
    validator: validateGetOrgTemplateRulesRequest,
  },
  (req: LambdaRequest) => c.handleGetOrgTemplateRules(req),
);

export default main;
