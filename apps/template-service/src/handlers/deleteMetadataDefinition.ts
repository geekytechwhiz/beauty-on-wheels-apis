import { buildDeleteMetadataDefinitionHandler } from '@api-hub/template';
import { getTemplateRuntime } from '../runtime';

export const main = buildDeleteMetadataDefinitionHandler(getTemplateRuntime().deleteMetadataDefinitionUseCase);
