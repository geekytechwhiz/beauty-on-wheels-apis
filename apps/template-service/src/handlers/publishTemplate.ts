import { buildPublishTemplateHandler } from '@api-hub/template';
import { getTemplateRuntime } from '../runtime';

export const main = buildPublishTemplateHandler(getTemplateRuntime().publishTemplateUseCase);
