import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { validateListCompatibleTemplatesRequest } from '../../validators/request.validators';

const c = getTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.compatible.list',
    validator: validateListCompatibleTemplatesRequest,
  },
  (req: LambdaRequest) => c.handleListCompatible(req),
);

export default main;
