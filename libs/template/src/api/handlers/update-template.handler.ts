import { withLambdaHandler, type LambdaRequest } from '@api-hub/utils';
import type { UpdateTemplateUseCase } from '../../application';
import { ensureHttpError } from '../http-error.mapper';
import { validateUpdateTemplate } from '../request.validators';

export function buildUpdateTemplateHandler(useCase: UpdateTemplateUseCase) {
  return withLambdaHandler(
    async (req: LambdaRequest) => {
      try {
        return await useCase.execute(
          (req as LambdaRequest & {
            validatedUpdateTemplate: Parameters<UpdateTemplateUseCase['execute']>[0];
          }).validatedUpdateTemplate,
        );
      } catch (error) {
        throw ensureHttpError(error);
      }
    },
    {
      validator: validateUpdateTemplate,
      successMessageKey: 'TEMPLATE.TEMPLATE_UPDATED_SUCCESS',
    },
  );
}
