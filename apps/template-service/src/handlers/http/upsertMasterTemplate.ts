import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getOrgTemplateHttpController } from '../../controllers/org-template-http.controller';
import { getTemplateHttpController } from '../../controllers/template-http.controller';
import {
  MASTER_TEMPLATE_CREATED,
  MASTER_TEMPLATE_UPDATED,
  ORG_CARE_PLAN_TEMPLATE_CREATED,
  ORG_CARE_PLAN_TEMPLATE_UPDATED,
} from '../../utils/template-api-messages';
import { templateCreated, templateOk } from '../../utils/template-handler.util';
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

const handler = async (req: LambdaRequest) => {
  if (isOrgCarePlanUpsert(req)) {
    const data = hasPathTemplateId(req)
      ? await orgCtrl.handleUpdateOrgCarePlan(req)
      : await orgCtrl.handleCreateOrgCarePlan(req);
    const message = hasPathTemplateId(req)
      ? ORG_CARE_PLAN_TEMPLATE_UPDATED
      : ORG_CARE_PLAN_TEMPLATE_CREATED;
    return hasPathTemplateId(req)
      ? templateOk(req, data, message)
      : templateCreated(req, data, message);
  }

  const data = hasPathTemplateId(req)
    ? await masterCtrl.handleSaveMaster(req)
    : await masterCtrl.handleCreateMaster(req);
  const message = hasPathTemplateId(req) ? MASTER_TEMPLATE_UPDATED : MASTER_TEMPLATE_CREATED;
  return hasPathTemplateId(req)
    ? templateOk(req, data, message)
    : templateCreated(req, data, message);
};

export const main = withApiHandler(
  {
    operation: 'template.master.upsert',
    bodySchema: upsertMasterTemplateBodySchema,
    validator: validateUpsertMasterTemplateRequest,
    useLegacyResponseFormat: true,
  },
  handler,
);

export default main;
