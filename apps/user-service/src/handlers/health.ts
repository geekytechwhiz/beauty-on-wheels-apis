import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';

interface Params {
  [key: string]: unknown;
}

const handler = async (_req: LambdaRequest<Params>) => {
  return { status: 'ok', service: 'user-service' };
};

export const main = withLambdaHandler(handler);
