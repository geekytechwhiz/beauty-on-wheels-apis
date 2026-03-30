import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { TEMPLATE_MASTER_ORG_ID, type UpdateTemplateBody } from '@api-hub/template-core';
import { getTemplateService } from '../services/template.service';
import { throwVal, validateUpdateTemplate } from '../validation/request.validators';

const updateTemplateHandler = async (req: LambdaRequest) => {
  const jwtOrgId = (req as LambdaRequest & { validatedOrganizationId: string }).validatedOrganizationId;
  const { templateId, payload, scope } = (
    req as LambdaRequest & {
      validatedUpdateTemplate: { templateId: string; payload: UpdateTemplateBody; scope: 'org' | 'master' };
    }
  ).validatedUpdateTemplate;
  const orgId = scope === 'master' ? TEMPLATE_MASTER_ORG_ID : jwtOrgId;
  try {
    return await getTemplateService().updateTemplate(orgId, templateId, payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('TEMPLATE_NOT_FOUND')) {
      throwVal('Template not found', 404, 'TEMPLATE.TEMPLATE_NOT_FOUND');
    }
    if (msg.includes('TEMPLATE_VERSION_COLLISION')) {
      throwVal('Template version conflict', 409, 'TEMPLATE.TEMPLATE_VERSION_CONFLICT');
    }
    throw err;
  }
};

export const main = withLambdaHandler(updateTemplateHandler, {
  validator: validateUpdateTemplate,
  successMessageKey: 'TEMPLATE.TEMPLATE_UPDATED_SUCCESS',
});
