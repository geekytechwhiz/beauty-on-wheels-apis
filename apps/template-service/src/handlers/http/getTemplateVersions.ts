import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { getTemplateHttpController } from '../../controllers/template-http.controller';
import {
  validateGetMasterVersionsRequest,
  validateGetOrgVersionsRequest,
} from '../../validators/request.validators';
import { resolveTemplateLevelFromQuery } from '../../validators/template-level.util';

const masterCtrl = getTemplateHttpController();
const orgCtrl = getOrgTemplateHttpController();

export const main = withApiHandler(
  {
    operation: 'template.versions.get',
    validator: async (req: LambdaRequest) => {
      const level = resolveTemplateLevelFromQuery(req);
      if (level === 'ORG') {
        await validateGetOrgVersionsRequest(req);
      } else {
        await validateGetMasterVersionsRequest(req);
      }
    },
  },
  async (req: LambdaRequest) => {
    const level = resolveTemplateLevelFromQuery(req);
    if (level === 'ORG') {
      return orgCtrl.handleGetOrgVersions(req);
    }
    return masterCtrl.handleGetMasterVersions(req);
  },
);

export default main;
