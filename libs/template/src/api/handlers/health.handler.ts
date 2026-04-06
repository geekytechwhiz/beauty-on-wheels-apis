import { withLambdaHandler } from '@api-hub/utils';

export function buildHealthHandler() {
  return withLambdaHandler(async () => ({ status: 'ok' as const }), {
    successMessageKey: 'HEALTHHEALTH_CHECK_OK',
  });
}
