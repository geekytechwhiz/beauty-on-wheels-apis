import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { getTemplateHttpController } from '../../controllers/template-http.controller';
import {
  validateListMasterRequest,
  validateListOrgTemplatesRequest,
} from '../../validators/request.validators';
import { resolveTemplateLevelFromQuery } from '../../validators/template-level.util';

const masterCtrl = getTemplateHttpController();
const orgCtrl = getOrgTemplateHttpController();

export const main = withApiHandler(
  {
    operation: 'template.list',
    validator: async (req: LambdaRequest) => {
      const level = resolveTemplateLevelFromQuery(req);
      if (level === 'ORG') {
        await validateListOrgTemplatesRequest(req);
      } else {
        await validateListMasterRequest(req);
      }
    },
  },
  async (req: LambdaRequest) => {
    const level = resolveTemplateLevelFromQuery(req);
    if (level === 'ORG') {
      return orgCtrl.handleListOrg(req);
    }
    return masterCtrl.handleListMaster(req);
  },
);

export default main;
