import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import type { CreateTemplateBody } from '@api-hub/template-core';
import { getTemplateService } from '../services/template.service';
import { throwVal, validateCreateTemplate } from '../validation/request.validators';

const createTemplateHandler = async (req: LambdaRequest) => {
  const orgId = (req as LambdaRequest & { validatedOrganizationId: string }).validatedOrganizationId;
  const body = (req as LambdaRequest & { validatedCreateTemplate: CreateTemplateBody }).validatedCreateTemplate;
  try {
    return await getTemplateService().createTemplate(orgId, body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('TEMPLATE_VERSION_EXISTS')) {
      throwVal('Template version already exists', 409, 'TEMPLATE.TEMPLATE_VERSION_EXISTS');
    }
    throw err;
  }
};

export const main = withLambdaHandler(createTemplateHandler, {
  validator: validateCreateTemplate,
  successMessageKey: 'TEMPLATE.TEMPLATE_CREATED_SUCCESS',
  useCreated: true,
});
