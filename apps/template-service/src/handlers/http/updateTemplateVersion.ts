import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { getTemplateHttpController } from '../../controllers/template-http.controller';
import {
  validateUpdateMasterVersionRequest,
  validateUpdateOrgTemplateVersionRequest,
} from '../../validators/request.validators';
import { resolveTemplateLevelFromQuery } from '../../validators/template-level.util';

const masterCtrl = getTemplateHttpController();
const orgCtrl = getOrgTemplateHttpController();

export const main = withApiHandler(
  {
    operation: 'template.version.update',
    validator: async (req: LambdaRequest) => {
      const level = resolveTemplateLevelFromQuery(req);
      if (level === 'ORG') {
        await validateUpdateOrgTemplateVersionRequest(req);
      } else {
        await validateUpdateMasterVersionRequest(req);
      }
    },
  },
  async (req: LambdaRequest) => {
    const level = resolveTemplateLevelFromQuery(req);
    if (level === 'ORG') {
      return orgCtrl.handleUpdateOrgVersion(req);
    }
    return masterCtrl.handleUpdateMasterVersion(req);
  },
);

export default main;
