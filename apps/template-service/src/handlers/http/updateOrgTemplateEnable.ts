import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { validateSetOrgTemplateEnableRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.derive.update',
    validator: validateSetOrgTemplateEnableRequest,
  },
  (req: LambdaRequest) => c.handleSetOrgTemplateEnable(req),
);

export default main;
