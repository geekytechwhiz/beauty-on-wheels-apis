import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getEnablementHttpController } from '../../controllers/enablement-http.controller';
import { validateListOrgEnablementsByOrgRequest } from '../../validators/request.validators';

const c = getEnablementHttpController();

export const main = withApiHandler(
  {
    operation: 'org-enablement.list-by-org',
    validator: validateListOrgEnablementsByOrgRequest,
  },
  (req: LambdaRequest) => c.handleListEnablementsByOrg(req),
);

export default main;
