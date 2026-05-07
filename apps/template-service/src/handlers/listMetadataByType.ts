import { buildListMetadataByTypeHandler } from '@api-hub/template';
import { getTemplateRuntime } from '../runtime';

export const main = buildListMetadataByTypeHandler(getTemplateRuntime().listMetadataByTypeUseCase);
