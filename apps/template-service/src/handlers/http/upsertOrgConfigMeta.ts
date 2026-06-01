import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgConfigMetaHttpController } from '../../controllers/org-config-meta-http.controller';
import { validateUpsertOrgConfigMetaRequest } from '../../validators/request.validators';

const c = getOrgConfigMetaHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.org-config-meta.upsert',
    validator: validateUpsertOrgConfigMetaRequest,
  },
  (req: LambdaRequest) => c.handleUpsertOrgConfigMeta(req),
);

export default main;
