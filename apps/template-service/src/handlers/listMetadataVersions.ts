import { buildListMetadataVersionsHandler } from '@api-hub/template';
import { getTemplateRuntime } from '../runtime';

export const main = buildListMetadataVersionsHandler(getTemplateRuntime().listMetadataVersionsUseCase);
