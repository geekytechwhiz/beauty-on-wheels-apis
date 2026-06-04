import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { LambdaRequest } from '@api-hub/utils';

import { getEnablementHttpController } from '../../controllers/enablement-http.controller';
import { validateSearchOrgEnablementsRequest } from '../../validators/request.validators';

const c = getEnablementHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'org-enablement.search',
    validator: validateSearchOrgEnablementsRequest,
  },
  (req: LambdaRequest) => c.handleSearchEnablements(req),
);

export default main;
