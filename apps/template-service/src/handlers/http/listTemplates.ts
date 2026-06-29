import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { getTemplateHttpController } from '../../controllers/template-http.controller';
import {
  MASTER_TEMPLATES_LISTED,
  ORG_CARE_PLAN_TEMPLATES_LISTED,
  ORG_DERIVED_TEMPLATES_LISTED,
  ORG_ENABLE_CATALOG,
} from '../../utils/template-api-messages';
import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import {
  validateListMasterRequest,
  validateListOrgTemplatesRequest,
} from '../../validators/request.validators';
import {
  isOrgDerivedListLevel,
  resolveTemplateLevelFromQuery,
} from '../../validators/template-level.util';

const masterCtrl = getTemplateHttpController();
const orgCtrl = getOrgTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.list',
    resolveSuccessMessage: (req) => {
      const level = resolveTemplateLevelFromQuery(req);
      if (level === 'ORG_CARE_PLAN') return ORG_CARE_PLAN_TEMPLATES_LISTED;
      if (level === 'ORG_DERIVED') return ORG_DERIVED_TEMPLATES_LISTED;
      if (level === 'ORG') return ORG_ENABLE_CATALOG;
      return MASTER_TEMPLATES_LISTED;
    },
    validator: async (req: LambdaRequest) => {
      const level = resolveTemplateLevelFromQuery(req);
      if (isOrgDerivedListLevel(level) || level === 'ORG') {
        await validateListOrgTemplatesRequest(req);
      } else {
        await validateListMasterRequest(req);
      }
    },
  },
  async (req: LambdaRequest) => {
    const level = resolveTemplateLevelFromQuery(req);
    if (isOrgDerivedListLevel(level) || level === 'ORG') {
      return orgCtrl.handleListOrg(req);
    }
    return masterCtrl.handleListMaster(req);
  },
);

export default main;
