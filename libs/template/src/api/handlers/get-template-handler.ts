import { withLambdaHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';
import { TemplateNotFoundError } from '../../shared';
import type { GetTemplateUseCase } from '../../application';
import { ensureHttpError } from '../http-error.mapper';
import { validateGetTemplate } from '../request.validators';

export function buildGetTemplateHandler(useCase: GetTemplateUseCase) {
  return withLambdaHandler(
    async (req: LambdaRequest) => {
      try {
        const result = await useCase.execute(
          (req as LambdaRequest & {
            validatedGetTemplate: Parameters<GetTemplateUseCase['execute']>[0];
          }).validatedGetTemplate,
        );
        if (!result) {
          throw new TemplateNotFoundError();
        }
        return result;
      } catch (error) {
        throw ensureHttpError(error);
      }
    },
    {
      serviceName: 'template-service',
      operation: 'template.get',
      validator: validateGetTemplate,
      successMessageKey: 'TEMPLATE.TEMPLATE_RETRIEVED_SUCCESS',
    },
  );
}
