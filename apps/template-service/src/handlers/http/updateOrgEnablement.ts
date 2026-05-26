import { LambdaRequest } from '@api-hub/utils';

import { getEnablementHttpController } from '../../controllers/enablement-http.controller';
import { withApiHandlerOrNoContent } from '../../utils/api-handler.util';
import { validatePatchOrgEnablementRequest } from '../../validators/request.validators';
import { updateOrgEnablementBodySchema } from '../../validators/template.schemas';

const c = getEnablementHttpController();

export const main = withApiHandlerOrNoContent(
  {
    operation: 'org-enablement.patch',
    bodySchema: updateOrgEnablementBodySchema,
    validator: validatePatchOrgEnablementRequest,
  },
  (req: LambdaRequest) => c.handlePatchEnablement(req),
);

export default main;
