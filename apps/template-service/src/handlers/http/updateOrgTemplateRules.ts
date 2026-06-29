import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { templateOk, templateOperationMessage } from '../../utils/template-handler.util';
import { validateUpdateOrgTemplateRulesRequest } from '../../validators/request.validators';
import { updateOrgTemplateRulesBodySchema } from '../../validators/template.schemas';

const c = getOrgTemplateHttpController();

const handler = async (req: LambdaRequest) => {
  const data = await c.handleUpdateOrgTemplateRules(req);
  return templateOk(req, data, templateOperationMessage('template.org.rules.update'));
};

export const main = withApiHandler(
  {
    operation: 'template.org.rules.update',
    bodySchema: updateOrgTemplateRulesBodySchema,
    validator: validateUpdateOrgTemplateRulesRequest,
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
