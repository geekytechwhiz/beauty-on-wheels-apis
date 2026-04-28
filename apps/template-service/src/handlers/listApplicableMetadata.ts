import { buildListApplicableMetadataHandler } from '@api-hub/template';
import { getTemplateRuntime } from '../runtime';

export const main = buildListApplicableMetadataHandler(getTemplateRuntime().listApplicableMetadataUseCase);
