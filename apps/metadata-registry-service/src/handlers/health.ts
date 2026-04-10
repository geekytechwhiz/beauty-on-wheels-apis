import { withLambdaHandler } from '@api-hub/utils';

const handler = async () => {
  return {
    status: 'ok',
    service: 'metadata-registry-service',
    timestamp: new Date().toISOString(),
  };
};

export const main = withLambdaHandler(handler);
