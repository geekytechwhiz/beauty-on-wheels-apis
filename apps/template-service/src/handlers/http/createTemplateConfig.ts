import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateConfigHttpController } from '../../controllers/template-config-http.controller';
import { validateCreateTemplateConfigRequest } from '../../validators/request.validators';
import { createTemplateConfigBodySchema } from '../../validators/template.schemas';

const c = getTemplateConfigHttpController();

export const main = withApiHandler(
  {
    operation: 'template-config.create',
    bodySchema: createTemplateConfigBodySchema,
    validator: validateCreateTemplateConfigRequest,
  },
  (req: LambdaRequest) => c.handleCreateConfig(req),
);

export default main;
