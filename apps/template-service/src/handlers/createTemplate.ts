import { buildCreateTemplateHandler } from '@api-hub/template';
import { getTemplateRuntime } from '../runtime';

export const main = buildCreateTemplateHandler(getTemplateRuntime().createTemplateUseCase);
