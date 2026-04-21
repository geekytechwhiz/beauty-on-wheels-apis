import { buildCreateCarePlanDraftHandler } from '@api-hub/care-plan';
import { getTemplateRuntime } from '../runtime';

export const main = buildCreateCarePlanDraftHandler(getTemplateRuntime().createCarePlanDraftUseCase);
