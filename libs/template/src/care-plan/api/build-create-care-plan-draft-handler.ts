import { withLambdaHandler, type LambdaRequest } from '@api-hub/utils';
import { ensureHttpError } from '../../api/http-error.mapper';
import type { CreateCarePlanDraftUseCase } from '../create-care-plan-draft.use-case';
import { validateCreateCarePlanDraft } from './create-care-plan-draft.validators';

export function buildCreateCarePlanDraftHandler(useCase: CreateCarePlanDraftUseCase) {
  return withLambdaHandler(
    async (req: LambdaRequest) => {
      try {
        return await useCase.execute(
          (req as LambdaRequest & {
            validatedCreateCarePlanDraft: Parameters<CreateCarePlanDraftUseCase['execute']>[0];
          }).validatedCreateCarePlanDraft,
        );
      } catch (error) {
        throw ensureHttpError(error);
      }
    },
    {
      validator: validateCreateCarePlanDraft,
      successMessageKey: 'CARE_PLAN.CARE_PLAN_DRAFT_SUCCESS',
    },
  );
}
