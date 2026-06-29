import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateConfigHttpController } from '../../controllers/template-config-http.controller';
import { templateOk, templateOperationMessage } from '../../utils/template-handler.util';
import { validateGetTemplateConfigRequest } from '../../validators/request.validators';

const c = getTemplateConfigHttpController();

const handler = async (req: LambdaRequest) => {
  const data = await c.handleGetConfig(req);
  return templateOk(req, data, templateOperationMessage('template-config.get'));
};

export const main = withApiHandler(
  {
    operation: 'template-config.get',
    validator: validateGetTemplateConfigRequest,
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
