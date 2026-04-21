import { withLambdaHandler } from '@api-hub/utils';

export const main = withLambdaHandler(async () => ({ status: 'ok', service: 'metadata-registry-service' }), {
  useCreated: false,
});
