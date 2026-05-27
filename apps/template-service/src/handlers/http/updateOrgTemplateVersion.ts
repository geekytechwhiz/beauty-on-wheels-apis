import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { validateUpdateOrgTemplateVersionRequest } from '../../validators/request.validators';
import { updateOrgTemplateBodySchema } from '../../validators/template.schemas';

const c = getOrgTemplateHttpController();

export const main = withApiHandler(
  {
    operation: 'template.org.version.update',
    bodySchema: updateOrgTemplateBodySchema,
    validator: validateUpdateOrgTemplateVersionRequest,
  },
  (req: LambdaRequest) => c.handleUpdateOrgVersion(req),
);

export default main;
