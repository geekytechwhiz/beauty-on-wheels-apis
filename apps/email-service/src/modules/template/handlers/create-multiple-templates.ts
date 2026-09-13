import { withApiHandler } from '@api-hub/middleware';
import { BaseError, LambdaRequest } from '@api-hub/utils';
import { getTemplateRegistryProvider } from '../../../common/providers/container.js';
import { TemplateService } from '../services/TemplateService.js';
import { createMultipleTemplatesSchema } from '../dto/schemas.js';

const templateService = new TemplateService(getTemplateRegistryProvider());

function parseCreateMultipleTemplatesBody(body: unknown) {
  const result = createMultipleTemplatesSchema.safeParse(body ?? []);

  if (!result.success) {
    throw new BaseError(
      result.error.issues[0]?.message ?? 'Validation failed',
      400,
      'VALIDATION_ERROR',
      result.error.issues.map((i) => ({
        field: i.path.join('.') || undefined,
        message: i.message,
      })),
      { retryable: false },
    );
  }

  return result.data;
}

const handler = async (req: LambdaRequest) => {
  const templates = parseCreateMultipleTemplatesBody(req.body);
  const { successList, failedList } = await templateService.createMultipleTemplates(templates);

  return {
    message: 'Bulk template create completed',
    successList,
    failedList,
  };
};

export const main = withApiHandler({ operation: 'template.createMultiple' }, handler);

export default main;
