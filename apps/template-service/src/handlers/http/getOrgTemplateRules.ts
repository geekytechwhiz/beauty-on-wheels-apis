import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { templateOk, templateOperationMessage } from '../../utils/template-handler.util';
import { validateGetOrgTemplateRulesRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

const handler = async (req: LambdaRequest) => {
  const data = await c.handleGetOrgTemplateRules(req);
  return templateOk(req, data, templateOperationMessage('template.org.rules.get'));
};

export const main = withApiHandler(
  {
    operation: 'template.org.rules.get',
    validator: validateGetOrgTemplateRulesRequest,
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
