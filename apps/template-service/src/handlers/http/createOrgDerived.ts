import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { validateCreateOrgDerivedRequest } from '../../validators/request.validators';
import { orgDerivedCreateBodySchema } from '../../validators/template.schemas';

const c = getOrgTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.org-derived.create',
    useCreated: true,
    bodySchema: orgDerivedCreateBodySchema,
    validator: validateCreateOrgDerivedRequest,
  },
  (req: LambdaRequest) => c.handleCreateOrgDerived(req),
);

export default main;
