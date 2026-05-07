import { buildCreateMetadataDefinitionHandler } from '@api-hub/template';
import { getTemplateRuntime } from '../runtime';

export const main = buildCreateMetadataDefinitionHandler(getTemplateRuntime().createMetadataDefinitionUseCase);
