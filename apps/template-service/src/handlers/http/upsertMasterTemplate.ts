import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { getTemplateHttpController } from '../../controllers/template-http.controller';
import {
  MASTER_TEMPLATE_CREATED,
  MASTER_TEMPLATE_UPDATED,
  ORG_CARE_PLAN_TEMPLATE_CREATED,
  ORG_CARE_PLAN_TEMPLATE_UPDATED,
} from '../../utils/template-api-messages';
import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { validateUpsertMasterTemplateRequest } from '../../validators/request.validators';
import { upsertMasterTemplateBodySchema } from '../../validators/template.schemas';
import {
  resolveTemplateLevelFromBody,
  resolveTemplateLevelFromQuery,
} from '../../validators/template-level.util';

const masterCtrl = getTemplateHttpController();
const orgCtrl = getOrgTemplateHttpController();

function hasPathTemplateId(req: LambdaRequest): boolean {
  const raw = req.pathParameters?.templateId;
  return typeof raw === 'string' && raw.trim().length > 0;
}

function isOrgCarePlanUpsert(req: LambdaRequest): boolean {
  if (hasPathTemplateId(req)) {
    return resolveTemplateLevelFromQuery(req) === 'ORG_CARE_PLAN';
  }
  return resolveTemplateLevelFromBody(req.body) === 'ORG_CARE_PLAN';
}

export const main = withTemplateApiHandler(
  {
    operation: 'template.master.upsert',
    bodySchema: upsertMasterTemplateBodySchema,
    validator: validateUpsertMasterTemplateRequest,
    resolveSuccessMessage: (req) => {
      if (isOrgCarePlanUpsert(req)) {
        return hasPathTemplateId(req)
          ? ORG_CARE_PLAN_TEMPLATE_UPDATED
          : ORG_CARE_PLAN_TEMPLATE_CREATED;
      }
      return hasPathTemplateId(req) ? MASTER_TEMPLATE_UPDATED : MASTER_TEMPLATE_CREATED;
    },
  },
  (req: LambdaRequest) => {
    if (isOrgCarePlanUpsert(req)) {
      return hasPathTemplateId(req)
        ? orgCtrl.handleUpdateOrgCarePlan(req)
        : orgCtrl.handleCreateOrgCarePlan(req);
    }
    return hasPathTemplateId(req) ? masterCtrl.handleSaveMaster(req) : masterCtrl.handleCreateMaster(req);
  },
);

export default main;
