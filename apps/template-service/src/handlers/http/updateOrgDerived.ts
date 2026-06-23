import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { validateUpdateOrgDerivedRequest } from '../../validators/request.validators';
import { orgDerivedUpdateBodySchema } from '../../validators/template.schemas';

const c = getOrgTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.org-derived.update',
    bodySchema: orgDerivedUpdateBodySchema,
    validator: validateUpdateOrgDerivedRequest,
  },
  (req: LambdaRequest) => c.handleUpdateOrgDerived(req),
);

export default main;
