import { withLambdaHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';
import type { CreateTemplateUseCase } from '../../application';
import { ensureHttpError } from '../http-error.mapper';
import { validateCreateTemplate } from '../request.validators';

export function buildCreateTemplateHandler(useCase: CreateTemplateUseCase) {
  return withLambdaHandler(
    async (req: LambdaRequest) => {
      try {
        return await useCase.execute(
          (req as LambdaRequest & {
            validatedCreateTemplate: Parameters<CreateTemplateUseCase['execute']>[0];
          }).validatedCreateTemplate,
        );
      } catch (error) {
        throw ensureHttpError(error);
      }
    },
    {
      validator: validateCreateTemplate,
      successMessageKey: 'TEMPLATE.TEMPLATE_CREATED_SUCCESS',
      useCreated: true,
    },
  );
}
