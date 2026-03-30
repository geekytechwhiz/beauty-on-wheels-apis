import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import type { ExecuteTemplateBody } from '@api-hub/template-core';
import { getTemplateService } from '../services/template.service';
import { throwVal, validateExecuteTemplate } from '../validation/request.validators';

const executeTemplateHandler = async (req: LambdaRequest) => {
  const orgId = (req as LambdaRequest & { validatedOrganizationId: string }).validatedOrganizationId;
  const { templateId, payload } = (
    req as LambdaRequest & { validatedExecuteTemplate: { templateId: string; payload: ExecuteTemplateBody } }
  ).validatedExecuteTemplate;

  try {
    return await getTemplateService().executeTemplate(orgId, templateId, payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('TEMPLATE_NOT_FOUND')) {
      throwVal('Template not found', 404, 'TEMPLATE.TEMPLATE_NOT_FOUND');
    }
    if (msg.includes('TEMPLATE_INHERITANCE')) {
      throwVal('Template resolve failed', 400, 'TEMPLATE.TEMPLATE_RESOLVE_FAILED');
    }
    throw err;
  }
};

export const main = withLambdaHandler(executeTemplateHandler, {
  validator: validateExecuteTemplate,
  successMessageKey: 'TEMPLATE.TEMPLATE_EXECUTED_SUCCESS',
});
