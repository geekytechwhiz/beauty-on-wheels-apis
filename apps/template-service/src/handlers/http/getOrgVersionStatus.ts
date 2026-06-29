import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { templateOk, templateOperationMessage } from '../../utils/template-handler.util';
import { validateOrgVersionStatusRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

const handler = async (req: LambdaRequest) => {
  const data = await c.handleGetOrgVersionStatus(req);
  return templateOk(req, data, templateOperationMessage('template.org.version-status'));
};

export const main = withApiHandler(
  {
    operation: 'template.org.version-status',
    validator: validateOrgVersionStatusRequest,
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
