import { buildUpdateTemplateHandler } from '@api-hub/template';
import { getTemplateRuntime } from '../runtime';

export const main = buildUpdateTemplateHandler(getTemplateRuntime().updateTemplateUseCase);
