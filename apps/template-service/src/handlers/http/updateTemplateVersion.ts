import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { validateUpdateOrgTemplateVersionRequest } from '../../validators/request.validators';

const orgCtrl = getOrgTemplateHttpController();

export const main = withApiHandler(
  {
    operation: 'template.version.update',
    validator: validateUpdateOrgTemplateVersionRequest,
  },
  (req: LambdaRequest) => orgCtrl.handleUpdateOrgVersion(req),
);

export default main;
