import { AlertService } from '@api-hub/alert-integration';

let instance: AlertService | undefined;

/**
 * App wiring: singleton for Lambda warm starts. All use-case and persistence logic live in
 * `@api-hub/alert-integration` and `@api-hub/alert-repository` — this module only provides the entry point.
 * @see `docs/http-api-implementation-guide.md` §3
 */
export function getAlertService(): AlertService {
  if (!instance) {
    instance = new AlertService();
  }
  return instance;
}
