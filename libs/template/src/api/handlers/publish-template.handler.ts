import { withLambdaHandler, type LambdaRequest } from '@api-hub/utils';
import type { PublishTemplateUseCase } from '../../application';
import { ensureHttpError } from '../http-error.mapper';
import { validatePublishTemplate } from '../request.validators';

export function buildPublishTemplateHandler(useCase: PublishTemplateUseCase) {
  return withLambdaHandler(
    async (req: LambdaRequest) => {
      try {
        return await useCase.execute(
          (req as LambdaRequest & {
            validatedPublishTemplate: Parameters<PublishTemplateUseCase['execute']>[0];
          }).validatedPublishTemplate,
        );
      } catch (error) {
        throw ensureHttpError(error);
      }
    },
    {
      validator: validatePublishTemplate,
      successMessageKey: 'TEMPLATE.TEMPLATE_PUBLISHED_SUCCESS',
    },
  );
}
