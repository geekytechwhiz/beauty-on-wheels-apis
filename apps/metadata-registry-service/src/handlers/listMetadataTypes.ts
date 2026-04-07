import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { getMetadataRegistryService } from '../runtime';

interface Params {
  [key: string]: unknown;
}

const handler = async (_req: LambdaRequest<Params>) => getMetadataRegistryService().listMetadataTypes();

export const main = withLambdaHandler(handler);
