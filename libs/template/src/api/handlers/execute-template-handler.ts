import { withLambdaHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';
import type { ExecuteTemplateUseCase } from '../../application';
import { ensureHttpError } from '../http-error.mapper';
import { validateExecuteTemplate } from '../request.validators';

export function buildExecuteTemplateHandler(useCase: ExecuteTemplateUseCase) {
  return withLambdaHandler(
    async (req: LambdaRequest) => {
      try {
        return await useCase.execute(
          (req as LambdaRequest & {
            validatedExecuteTemplate: Parameters<ExecuteTemplateUseCase['execute']>[0];
          }).validatedExecuteTemplate,
        );
      } catch (error) {
        throw ensureHttpError(error);
      }
    },
    {
      serviceName: 'template-service',
      operation: 'template.execute',
      validator: validateExecuteTemplate,
      successMessageKey: 'TEMPLATE.TEMPLATE_EXECUTED_SUCCESS',
    },
  );
}
