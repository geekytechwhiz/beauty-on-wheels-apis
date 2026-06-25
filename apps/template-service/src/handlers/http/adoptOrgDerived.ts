import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { validateAdoptOrgDerivedRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.org-derived.adopt',
    validator: validateAdoptOrgDerivedRequest,
  },
  (req: LambdaRequest) => c.handleAdoptOrgDerived(req),
);

export default main;
