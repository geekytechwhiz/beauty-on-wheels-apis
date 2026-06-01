import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgConfigMetaHttpController } from '../../controllers/org-config-meta-http.controller';
import { validateCreateOrgConfigMetaRequest } from '../../validators/request.validators';
import { createOrgConfigMetaBodySchema } from '../../validators/template.schemas';

const c = getOrgConfigMetaHttpController();

export const main = withApiHandler(
  {
    operation: 'template.master.org-config-meta.create',
    bodySchema: createOrgConfigMetaBodySchema,
    validator: validateCreateOrgConfigMetaRequest,
  },
  (req: LambdaRequest) => c.handleCreateOrgConfigMeta(req),
);

export default main;
