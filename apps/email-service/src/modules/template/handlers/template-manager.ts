import { withApiHandler } from '@api-hub/middleware';
import { BaseError, LambdaRequest } from '@api-hub/utils';
import { getTemplateRegistryProvider } from '../../../common/providers/container.js';
import { TemplateService } from '../services/TemplateService.js';
import { createTemplateSchema } from '../dto/schemas.js';

const templateService = new TemplateService(getTemplateRegistryProvider());

function parseCreateTemplateBody(body: unknown) {
  const result = createTemplateSchema.safeParse(body ?? {});

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

function notFoundError(templateName: string | undefined): BaseError {
  return new BaseError(
    `Template '${templateName}' not found`,
    404,
    'NOT_FOUND',
    [{ message: `Template '${templateName}' not found` }],
    { retryable: false },
  );
}

const handler = async (req: LambdaRequest) => {
  const { httpMethod } = req.event;
  const templateName = req.pathParameters?.templateName;

  try {
    if (httpMethod === 'GET') {
      if (templateName) {
        const template = await templateService.getTemplate(templateName);
        return {
          template: {
            TemplateName: template.templateName,
            SubjectPart: template.subject,
            HtmlPart: template.htmlContent,
            TextPart: template.textContent,
          },
        };
      }

      const list = await templateService.listTemplates();
      return { templates: list };
    }

    if (httpMethod === 'POST') {
      const body = parseCreateTemplateBody(req.body);
      await templateService.createTemplate(body);

      return {
        message: 'Template created successfully',
        templateName: body.templateName,
      };
    }

    if (httpMethod === 'DELETE') {
      if (!templateName) {
        throw new BaseError(
          'Template name is required',
          400,
          'INVALID_REQUEST',
          [{ message: 'Template name is required' }],
          { retryable: false },
        );
      }

      await templateService.deleteTemplate(templateName);
      return {
        message: 'Template deleted successfully',
        templateName,
      };
    }

    throw new BaseError(
      'Method not allowed',
      405,
      'METHOD_NOT_ALLOWED',
      [{ message: `Method '${httpMethod}' not allowed` }],
      { retryable: false },
    );
  } catch (error: any) {
    if (error.name === 'NotFoundException' || error.name === 'ResourceNotFoundException') {
      throw notFoundError(templateName);
    }
    if (error.name === 'AlreadyExistsException') {
      throw new BaseError(
        'Template already exists',
        409,
        'CONFLICT',
        [{ message: 'Template already exists' }],
        { retryable: false },
      );
    }
    throw error;
  }
};

export const main = withApiHandler({ operation: 'template.manage' }, handler);

export default main;
