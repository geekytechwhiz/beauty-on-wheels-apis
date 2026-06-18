import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateConfigHttpController } from '../../controllers/template-config-http.controller';
import { validateCreateTemplateConfigRequest } from '../../validators/request.validators';
import { createTemplateConfigBodySchema } from '../../validators/template.schemas';

const c = getTemplateConfigHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template-config.create',
    bodySchema: createTemplateConfigBodySchema,
    validator: validateCreateTemplateConfigRequest,
    useCreated: true,
  },
  (req: LambdaRequest) => c.handleCreateConfig(req),
);

export default main;
