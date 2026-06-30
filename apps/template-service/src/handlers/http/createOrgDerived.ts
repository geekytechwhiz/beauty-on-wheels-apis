import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { templateCreated, templateOperationMessage } from '../../utils/template-handler.util';
import { validateCreateOrgDerivedRequest } from '../../validators/request.validators';
import { orgDerivedCreateBodySchema } from '../../validators/template.schemas';

const c = getOrgTemplateHttpController();

const handler = async (req: LambdaRequest) => {
  const data = await c.handleCreateOrgDerived(req);
  return templateCreated(req, data, templateOperationMessage('template.org-derived.create'));
};

export const main = withApiHandler(
  {
    operation: 'template.org-derived.create',
    bodySchema: orgDerivedCreateBodySchema,
    validator: validateCreateOrgDerivedRequest,
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
