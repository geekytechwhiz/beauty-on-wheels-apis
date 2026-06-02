import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateConfigHttpController } from '../../controllers/template-config-http.controller';
import { validateListTemplateConfigsRequest } from '../../validators/request.validators';

const c = getTemplateConfigHttpController();

export const main = withApiHandler(
  {
    operation: 'template-config.list',
    validator: validateListTemplateConfigsRequest,
  },
  (req: LambdaRequest) => c.handleListConfigs(req),
);

export default main;
