import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateConfigHttpController } from '../../controllers/template-config-http.controller';
import { templateOk, templateOperationMessage } from '../../utils/template-handler.util';
import { validatePostTemplateConfigMetaRequest } from '../../validators/request.validators';

const c = getTemplateConfigHttpController();

const handler = async (req: LambdaRequest) => {
  const data = await c.handlePostMeta(req);
  return templateOk(req, data, templateOperationMessage('template-config.meta'));
};

export const main = withApiHandler(
  {
    operation: 'template-config.meta',
    validator: validatePostTemplateConfigMetaRequest,
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
