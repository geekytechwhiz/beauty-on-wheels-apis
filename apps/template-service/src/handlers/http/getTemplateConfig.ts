import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateConfigHttpController } from '../../controllers/template-config-http.controller';
import { validateGetTemplateConfigRequest } from '../../validators/request.validators';

const c = getTemplateConfigHttpController();

export const main = withApiHandler(
  {
    operation: 'template-config.get',
    validator: validateGetTemplateConfigRequest,
  },
  (req: LambdaRequest) => c.handleGetConfig(req),
);

export default main;
