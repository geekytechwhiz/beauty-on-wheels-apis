import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { templateOk, templateOperationMessage } from '../../utils/template-handler.util';
import { validateSetOrgTemplateEnableRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

const handler = async (req: LambdaRequest) => {
  const data = await c.handleSetOrgTemplateEnable(req);
  return templateOk(req, data, templateOperationMessage('template.derive.update'));
};

export const main = withApiHandler(
  {
    operation: 'template.derive.update',
    validator: validateSetOrgTemplateEnableRequest,
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
