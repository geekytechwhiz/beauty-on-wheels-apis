import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateConfigHttpController } from '../../controllers/template-config-http.controller';
import { validateUpdateTemplateConfigRequest } from '../../validators/request.validators';
import { updateTemplateConfigBodySchema } from '../../validators/template.schemas';

const c = getTemplateConfigHttpController();

export const main = withApiHandler(
  {
    operation: 'template-config.update',
    bodySchema: updateTemplateConfigBodySchema,
    validator: validateUpdateTemplateConfigRequest,
  },
  (req: LambdaRequest) => c.handleUpdateConfig(req),
);

export default main;
