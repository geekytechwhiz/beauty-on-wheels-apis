import { withLambdaHandler } from '@api-hub/middleware';

export function buildHealthHandler() {
  return withLambdaHandler(async () => ({ status: 'ok' as const }), {
    serviceName: 'template-service',
    operation: 'template.health',
    successMessageKey: 'HEALTH. HEALTH_CHECK_OK',
  });
}
