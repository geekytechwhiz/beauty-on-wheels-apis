import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { validateAdoptOrgDerivedRequest } from '../../validators/request.validators';
import { orgDerivedAdoptBodySchema } from '../../validators/template.schemas';

const c = getOrgTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.org-derived.adopt',
    bodySchema: orgDerivedAdoptBodySchema,
    validator: validateAdoptOrgDerivedRequest,
  },
  (req: LambdaRequest) => c.handleAdoptOrgDerived(req),
);

export default main;
