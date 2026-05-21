import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { validateListCompatibleTemplatesRequest } from '../../validators/request.validators';

const c = getTemplateHttpController();

export const main = withApiHandler(
  {
    operation: 'template.compatible.list',
    validator: validateListCompatibleTemplatesRequest,
  },
  (req: LambdaRequest) => c.handleListCompatible(req),
);

export default main;
