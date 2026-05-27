import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getEnablementHttpController } from '../../controllers/enablement-http.controller';
import { validateGetOrgEnablementRequest } from '../../validators/request.validators';

const c = getEnablementHttpController();

export const main = withApiHandler(
  {
    operation: 'org-enablement.get-by-id',
    validator: validateGetOrgEnablementRequest,
  },
  (req: LambdaRequest) => c.handleGetEnablement(req),
);

export default main;
