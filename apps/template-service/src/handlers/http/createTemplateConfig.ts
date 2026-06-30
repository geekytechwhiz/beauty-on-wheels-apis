import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateConfigHttpController } from '../../controllers/template-config-http.controller';
import { templateCreated, templateOperationMessage } from '../../utils/template-handler.util';
import { validateCreateTemplateConfigRequest } from '../../validators/request.validators';
import { createTemplateConfigBodySchema } from '../../validators/template.schemas';

const c = getTemplateConfigHttpController();

const handler = async (req: LambdaRequest) => {
  const data = await c.handleCreateConfig(req);
  return templateCreated(req, data, templateOperationMessage('template-config.create'));
};

export const main = withApiHandler(
  {
    operation: 'template-config.create',
    bodySchema: createTemplateConfigBodySchema,
    validator: validateCreateTemplateConfigRequest,
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
