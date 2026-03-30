import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { TEMPLATE_MASTER_ORG_ID } from '@api-hub/template-core';
import { getTemplateService } from '../services/template.service';
import { templateToResponse } from '../mappers/template.mapper';
import { throwVal, validateGetTemplate } from '../validation/request.validators';

const getTemplateHandler = async (req: LambdaRequest) => {
  const jwtOrgId = (req as LambdaRequest & { validatedOrganizationId: string }).validatedOrganizationId;
  const { templateId, version, scope } = (
    req as LambdaRequest & {
      validatedGetTemplate: { templateId: string; version?: string; scope: 'org' | 'master' };
    }
  ).validatedGetTemplate;
  const orgId = scope === 'master' ? TEMPLATE_MASTER_ORG_ID : jwtOrgId;
  const found = await getTemplateService().getTemplate(orgId, templateId, version);
  if (!found) {
    throwVal('Template not found', 404, 'TEMPLATE.TEMPLATE_NOT_FOUND');
  }
  return templateToResponse(found);
};

export const main = withLambdaHandler(getTemplateHandler, {
  validator: validateGetTemplate,
  successMessageKey: 'TEMPLATE.TEMPLATE_RETRIEVED_SUCCESS',
});
