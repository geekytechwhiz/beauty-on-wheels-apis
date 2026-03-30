import { withLambdaHandler } from '@api-hub/utils';

const healthHandler = async () => ({ status: 'ok' as const });

export const main = withLambdaHandler(healthHandler, {
  successMessageKey: 'HEALTH.HEALTH_CHECK_OK',
});
