import { withLambdaHandler } from '@api-hub/utils';

export function buildHealthHandler() {
  return withLambdaHandler(async () => ({ status: 'ok' as const }), {
    successMessageKey: 'HEALTH_HEALTH_CHECK_OK',
  });
}
