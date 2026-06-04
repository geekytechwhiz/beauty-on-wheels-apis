import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import {
  MASTER_TEMPLATE_CREATED,
  MASTER_TEMPLATE_UPDATED,
} from '../../utils/template-api-messages';
import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { validateUpsertMasterTemplateRequest } from '../../validators/request.validators';
import { upsertMasterTemplateBodySchema } from '../../validators/template.schemas';

const c = getTemplateHttpController();

function hasPathTemplateId(req: LambdaRequest): boolean {
  const raw = req.pathParameters?.templateId;
  return typeof raw === 'string' && raw.trim().length > 0;
}

export const main = withTemplateApiHandler(
  {
    operation: 'template.master.upsert',
    bodySchema: upsertMasterTemplateBodySchema,
    validator: validateUpsertMasterTemplateRequest,
    resolveSuccessMessage: (req) =>
      hasPathTemplateId(req) ? MASTER_TEMPLATE_UPDATED : MASTER_TEMPLATE_CREATED,
  },
  (req: LambdaRequest) =>
    hasPathTemplateId(req) ? c.handleSaveMaster(req) : c.handleCreateMaster(req),
);

export default main;
