import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { LambdaRequest } from '@api-hub/utils';
import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { validateCloneOrgTemplateRequest } from '../../validators/request.validators';

const c = getOrgTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.org.clone',
    validator: validateCloneOrgTemplateRequest,
  },
  (req: LambdaRequest) => c.handleCloneToOrg(req),
);

export default main;
