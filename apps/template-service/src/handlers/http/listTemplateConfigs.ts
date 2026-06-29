import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateConfigHttpController } from '../../controllers/template-config-http.controller';
import { templateOk, templateOperationMessage } from '../../utils/template-handler.util';
import { validateListTemplateConfigsRequest } from '../../validators/request.validators';

const c = getTemplateConfigHttpController();

const handler = async (req: LambdaRequest) => {
  const data = await c.handleListConfigs(req);
  return templateOk(req, data, templateOperationMessage('template-config.list'));
};

export const main = withApiHandler(
  {
    operation: 'template-config.list',
    validator: validateListTemplateConfigsRequest,
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
