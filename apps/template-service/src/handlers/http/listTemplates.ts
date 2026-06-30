import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { getTemplateHttpController } from '../../controllers/template-http.controller';
import {
  MASTER_TEMPLATES_LISTED,
  ORG_CARE_PLAN_TEMPLATES_LISTED,
  ORG_DERIVED_TEMPLATES_LISTED,
  ORG_ENABLE_CATALOG,
} from '../../utils/template-api-messages';
import { templateOk } from '../../utils/template-handler.util';
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

const handler = async (req: LambdaRequest) => {
  const level = resolveTemplateLevelFromQuery(req);
  if (isOrgDerivedListLevel(level) || level === 'ORG') {
    const data = await orgCtrl.handleListOrg(req);
    const message =
      level === 'ORG_CARE_PLAN'
        ? ORG_CARE_PLAN_TEMPLATES_LISTED
        : level === 'ORG_DERIVED'
          ? ORG_DERIVED_TEMPLATES_LISTED
          : ORG_ENABLE_CATALOG;
    return templateOk(req, data, message);
  }

  const data = await masterCtrl.handleListMaster(req);
  return templateOk(req, data, MASTER_TEMPLATES_LISTED);
};

export const main = withApiHandler(
  {
    operation: 'template.list',
    validator: async (req: LambdaRequest) => {
      const level = resolveTemplateLevelFromQuery(req);
      if (isOrgDerivedListLevel(level) || level === 'ORG') {
        await validateListOrgTemplatesRequest(req);
      } else {
        await validateListMasterRequest(req);
      }
    },
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
