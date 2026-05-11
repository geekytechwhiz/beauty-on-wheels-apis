import { buildGetMetadataDefinitionHandler } from '@api-hub/template';
import { getTemplateRuntime } from '../runtime';

export const main = buildGetMetadataDefinitionHandler(getTemplateRuntime().getMetadataDefinitionUseCase);
