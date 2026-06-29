import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { templateOk, templateOperationMessage } from '../../utils/template-handler.util';
import { validateAdoptOrgDerivedRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

const handler = async (req: LambdaRequest) => {
  const data = await c.handleAdoptOrgDerived(req);
  return templateOk(req, data, templateOperationMessage('template.org-derived.adopt'));
};

export const main = withApiHandler(
  {
    operation: 'template.org-derived.adopt',
    validator: validateAdoptOrgDerivedRequest,
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
