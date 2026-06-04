import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { validateUpdateOrgTemplateVersionRequest } from '../../validators/request.validators';

const orgCtrl = getOrgTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.version.update',
    validator: validateUpdateOrgTemplateVersionRequest,
  },
  (req: LambdaRequest) => orgCtrl.handleUpdateOrgVersion(req),
);

export default main;
