import { buildGetTemplateHandler } from '@api-hub/template';
import { getTemplateRuntime } from '../runtime';

export const main = buildGetTemplateHandler(getTemplateRuntime().getTemplateUseCase);
