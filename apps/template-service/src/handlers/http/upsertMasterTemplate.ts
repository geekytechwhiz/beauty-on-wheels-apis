import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { validateUpsertMasterTemplateRequest } from '../../validators/request.validators';
import { upsertMasterTemplateBodySchema } from '../../validators/template.schemas';

const c = getTemplateHttpController();

function hasPathTemplateId(req: LambdaRequest): boolean {
  const raw = req.pathParameters?.templateId;
  return typeof raw === 'string' && raw.trim().length > 0;
}

export const main = withApiHandler(
  {
    operation: 'template.master.upsert',
    bodySchema: upsertMasterTemplateBodySchema,
    validator: validateUpsertMasterTemplateRequest,
  },
  (req: LambdaRequest) =>
    hasPathTemplateId(req) ? c.handleSaveMaster(req) : c.handleCreateMaster(req),
);

export default main;
