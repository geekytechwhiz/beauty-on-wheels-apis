import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgConfigMetaHttpController } from '../../controllers/org-config-meta-http.controller';
import { validateGetOrgConfigMetaByKeyRequest } from '../../validators/request.validators';

const c = getOrgConfigMetaHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.org-config-meta.getByKey',
    validator: validateGetOrgConfigMetaByKeyRequest,
  },
  (req: LambdaRequest) => c.handleGetOrgConfigMetaByKey(req),
);

export default main;
