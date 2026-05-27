import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getEnablementHttpController } from '../../controllers/enablement-http.controller';
import { validateCreateOrgEnablementRequest } from '../../validators/request.validators';
import { createOrgEnablementBodySchema } from '../../validators/template.schemas';

const c = getEnablementHttpController();

export const main = withApiHandler(
  {
    operation: 'org-enablement.create',
    bodySchema: createOrgEnablementBodySchema,
    validator: validateCreateOrgEnablementRequest,
  },
  (req: LambdaRequest) => c.handleCreateEnablement(req),
);

export default main;
