import { LambdaRequest } from '@api-hub/utils';

import { getTemplateConfigHttpController } from '../../controllers/template-config-http.controller';
import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { validatePostTemplateConfigMetaRequest } from '../../validators/request.validators';

const c = getTemplateConfigHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template-config.meta',
    validator: validatePostTemplateConfigMetaRequest,
  },
  (req: LambdaRequest) => c.handlePostMeta(req),
);

export default main;
