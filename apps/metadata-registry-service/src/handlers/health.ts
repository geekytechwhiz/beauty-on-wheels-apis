import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';

interface Params {
  [key: string]: unknown;
}

const handler = async (_req: LambdaRequest<Params>) => ({
  status: 'ok',
  service: 'metadata-registry-service',
});

export const main = withLambdaHandler(handler);
