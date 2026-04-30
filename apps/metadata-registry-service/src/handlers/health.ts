import { withLambdaHandler } from '@api-hub/middleware';

export const main = withLambdaHandler(async () => ({ status: 'ok', service: 'metadata-registry-service' }), {
  useCreated: false,
});
