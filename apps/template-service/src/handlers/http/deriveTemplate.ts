import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { templateCreated, templateOperationMessage } from '../../utils/template-handler.util';
import { validateDeriveTemplateRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

const handler = async (req: LambdaRequest) => {
  const data = await c.handleCloneToOrg(req);
  return templateCreated(req, data, templateOperationMessage('template.derive'));
};

export const main = withApiHandler(
  {
    operation: 'template.derive',
    validator: validateDeriveTemplateRequest,
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
