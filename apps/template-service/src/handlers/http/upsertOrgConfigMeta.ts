import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgConfigMetaHttpController } from '../../controllers/org-config-meta-http.controller';
import { validateUpdateOrgConfigMetaRequest } from '../../validators/request.validators';
import { upsertOrgConfigMetaBodySchema } from '../../validators/template.schemas';

const c = getOrgConfigMetaHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.org-config-meta.update',
    bodySchema: upsertOrgConfigMetaBodySchema,
    validator: validateUpdateOrgConfigMetaRequest,
  },
  (req: LambdaRequest) => c.handleUpdateOrgConfigMeta(req),
);

export default main;
