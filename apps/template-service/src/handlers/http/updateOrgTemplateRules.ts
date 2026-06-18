import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { validateUpdateOrgTemplateRulesRequest } from '../../validators/request.validators';
import { updateOrgTemplateRulesBodySchema } from '../../validators/template.schemas';

const c = getOrgTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.org.rules.update',
    bodySchema: updateOrgTemplateRulesBodySchema,
    validator: validateUpdateOrgTemplateRulesRequest,
  },
  (req: LambdaRequest) => c.handleUpdateOrgTemplateRules(req),
);

export default main;
