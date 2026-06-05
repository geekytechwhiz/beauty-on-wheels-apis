import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { LambdaRequest } from '@api-hub/utils';

import { getEnablementHttpController } from '../../controllers/enablement-http.controller';
import { validateCreateOrgEnablementRequest } from '../../validators/request.validators';
import { createOrgEnablementBodySchema } from '../../validators/template.schemas';

const c = getEnablementHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'org-enablement.create',
    useCreated: true,
    bodySchema: createOrgEnablementBodySchema,
    validator: validateCreateOrgEnablementRequest,
  },
  (req: LambdaRequest) => c.handleCreateEnablement(req),
);

export default main;
