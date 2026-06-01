import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgConfigMetaHttpController } from '../../controllers/org-config-meta-http.controller';
import { validateListOrgConfigMetaRequest } from '../../validators/request.validators';

const c = getOrgConfigMetaHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.org-config-meta.list',
    validator: validateListOrgConfigMetaRequest,
  },
  (req: LambdaRequest) => c.handleListOrgConfigMeta(req),
);

export default main;
