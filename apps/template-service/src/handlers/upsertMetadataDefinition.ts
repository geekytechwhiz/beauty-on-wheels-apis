import { buildUpsertMetadataDefinitionHandler } from '@api-hub/template';
import { getTemplateRuntime } from '../runtime';

export const main = buildUpsertMetadataDefinitionHandler(getTemplateRuntime().upsertMetadataDefinitionUseCase);
