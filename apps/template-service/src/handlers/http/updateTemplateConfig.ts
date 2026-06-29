import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateConfigHttpController } from '../../controllers/template-config-http.controller';
import { templateOk, templateOperationMessage } from '../../utils/template-handler.util';
import { validateUpdateTemplateConfigRequest } from '../../validators/request.validators';
import { updateTemplateConfigBodySchema } from '../../validators/template.schemas';

const c = getTemplateConfigHttpController();

const handler = async (req: LambdaRequest) => {
  const data = await c.handleUpdateConfig(req);
  return templateOk(req, data, templateOperationMessage('template-config.update'));
};

export const main = withApiHandler(
  {
    operation: 'template-config.update',
    bodySchema: updateTemplateConfigBodySchema,
    validator: validateUpdateTemplateConfigRequest,
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
