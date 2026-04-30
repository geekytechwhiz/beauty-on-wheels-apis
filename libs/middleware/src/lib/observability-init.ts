import { getConfig } from '@api-hub/observability';

let ensured = false;

/**
 * Warm observability config (env defaults + optional `configureObservability`) before metrics/logging paths run.
 */
export function ensureObservabilityInitialized(): void {
  if (ensured) {
    return;
  }
  ensured = true;
  getConfig();
}
