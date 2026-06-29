import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { templateOk, templateOperationMessage } from '../../utils/template-handler.util';
import { validateUpdateOrgDerivedRequest } from '../../validators/request.validators';
import { orgDerivedUpdateBodySchema } from '../../validators/template.schemas';

const c = getOrgTemplateHttpController();

const handler = async (req: LambdaRequest) => {
  const data = await c.handleUpdateOrgDerived(req);
  return templateOk(req, data, templateOperationMessage('template.org-derived.update'));
};

export const main = withApiHandler(
  {
    operation: 'template.org-derived.update',
    bodySchema: orgDerivedUpdateBodySchema,
    validator: validateUpdateOrgDerivedRequest,
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
